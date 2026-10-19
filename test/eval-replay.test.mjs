import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

async function api() {
  try { return { ...(await import("../src/evaluation/replay.mjs")), ...(await import("../src/evaluation/report.mjs")) }; }
  catch { return {}; }
}

const iso = "2026-10-16T00:00:00.000Z";
const hash = `sha256:${"a".repeat(64)}`;
const event = (overrides = {}) => ({ schemaVersion: 1, eventId: "event-1", eventType: "practice-assessed", timestamp: iso, host: "test-host", input: {}, output: {}, ...overrides });

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "loom-eval-replay-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".concept-loom/evaluation"), { recursive: true });
  return root;
}

test("replay requires explicit event IDs and persists deterministic result identity", async t => {
  const { replayEvents } = await api();
  assert.equal(typeof replayEvents, "function");
  const root = await workspace(t);
  await writeFile(join(root, ".concept-loom/evaluation/events.jsonl"), `${JSON.stringify(event())}\n`);
  await assert.rejects(replayEvents(root, { evaluatorSetVersion: "1" }), /eventIds/i);
  const first = await replayEvents(root, { eventIds: ["event-1"], evaluatorSetVersion: "deterministic-1" });
  const second = await replayEvents(root, { eventIds: ["event-1"], evaluatorSetVersion: "deterministic-1" });
  assert.equal(first.results[0].result.passed, true);
  assert.equal(first.results[0].identity.eventId, "event-1");
  assert.deepEqual(second.results[0], first.results[0]);
  const lines = (await readFile(join(root, ".concept-loom/evaluation/results.jsonl"), "utf8")).trim().split(/\r?\n/);
  assert.equal(lines.length, 1);
});

test("replay with an unavailable source revision is inconclusive instead of reconstructing context", async t => {
  const { replayEvents } = await api();
  assert.equal(typeof replayEvents, "function");
  const root = await workspace(t);
  await writeFile(join(root, ".concept-loom/evaluation/events.jsonl"), `${JSON.stringify(event({ sourceHashes: [hash] }))}\n`);
  const result = await replayEvents(root, { eventIds: ["event-1"], evaluatorSetVersion: "1" });
  assert.equal(result.results[0].result.status, "error");
  assert.ok(result.results[0].result.diagnostics.some(item => item.code === "SOURCE_REVISION_MISSING"));
});

test("malformed JSONL line is diagnosed while valid events remain replayable", async t => {
  const { replayEvents } = await api();
  assert.equal(typeof replayEvents, "function");
  const root = await workspace(t);
  const original = `not-json\n${JSON.stringify(event())}\n`;
  await writeFile(join(root, ".concept-loom/evaluation/events.jsonl"), original);
  const result = await replayEvents(root, { eventIds: ["event-1"], evaluatorSetVersion: "1" });
  assert.equal(result.results[0].result.passed, true);
  assert.ok(result.diagnostics.some(item => item.code === "CAPTURE_LINE_INVALID" && item.line === 1));
  assert.equal(await readFile(join(root, ".concept-loom/evaluation/events.jsonl"), "utf8"), original);
});

test("changing a prompt digest creates a new replay result without overwriting the prior revision", async t => {
  const { replayEvents } = await api();
  assert.equal(typeof replayEvents, "function");
  const root = await workspace(t);
  await writeFile(join(root, ".concept-loom/evaluation/events.jsonl"), `${JSON.stringify(event({ promptId: "diagnose", promptDigest: hash }))}\n`);
  const first = await replayEvents(root, { eventIds: ["event-1"], evaluatorSetVersion: "1", evaluatorPromptDigest: hash, promptDigests: { diagnose: hash } });
  const nextHash = `sha256:${"b".repeat(64)}`;
  const second = await replayEvents(root, { eventIds: ["event-1"], evaluatorSetVersion: "1", evaluatorPromptDigest: nextHash, promptDigests: { diagnose: hash } });
  assert.notEqual(first.results[0].identity.promptDigest, second.results[0].identity.promptDigest);
  const lines = (await readFile(join(root, ".concept-loom/evaluation/results.jsonl"), "utf8")).trim().split(/\r?\n/);
  assert.equal(lines.length, 2);
});

test("report blocks incomplete required cases and exposes evidence gaps and versions", async () => {
  const { buildEvalReport } = await api();
  assert.equal(typeof buildEvalReport, "function");
  const report = buildEvalReport({
    expectedCaseIds: ["event-1", "event-2", "event-3", "event-4"],
    results: [
      { identity: { eventId: "event-1" }, result: { status: "completed", passed: true } },
      { identity: { eventId: "event-2" }, result: { status: "completed", passed: false, diagnostics: [{ code: "CRITICAL_FAILURE" }] } },
      { identity: { eventId: "event-3" }, result: { status: "error" } },
    ],
    datasetVersion: "dataset/1",
    evaluatorSetVersion: "eval/1",
    promptDigest: hash,
    sourceHashes: [hash],
  });
  assert.equal(report.gate.pass, false);
  assert.ok(report.gate.failures.some(item => item.code === "CASE_ERROR"));
  assert.ok(report.gate.failures.some(item => item.code === "CASE_MISSING"));
  assert.equal(report.hostEvidenceGaps.length > 0, true);
  assert.equal(report.versions.dataset, "dataset/1");
  assert.match(report.markdown, /event-4/);
});

test("report cannot declare release while human rubric labels remain pending", async () => {
  const { buildEvalReport } = await api();
  const report = buildEvalReport({
    expectedCaseIds: ["teach-1"],
    results: [{ caseId: "teach-1", status: "completed", passed: true }],
    pendingLabels: 1,
  });
  assert.equal(report.gate.pass, false);
  assert.ok(report.gate.failures.some(item => item.code === "LABELS_PENDING_REVIEW"));
});

test("building a report does not mutate learner state", async t => {
  const { buildEvalReport } = await api();
  assert.equal(typeof buildEvalReport, "function");
  const root = await workspace(t);
  const learnerStatePath = join(root, ".concept-loom/progress/state.json");
  await mkdir(join(root, ".concept-loom/progress"), { recursive: true });
  await writeFile(learnerStatePath, JSON.stringify({ revision: 4, mastery: { conceptA: 2 } }));
  const before = await readFile(learnerStatePath, "utf8");
  buildEvalReport({ expectedCaseIds: ["event-1"], results: [] });
  assert.equal(await readFile(learnerStatePath, "utf8"), before);
});

test("report CLI emits JSON and Markdown, keeps calibration and holdout separate, and blocks unreviewed teaching cases", async t => {
  const { runEvaluationReport } = await import("../scripts/eval-report.mjs");
  const root = await workspace(t);
  const outputPath = join(root, "report.json");
  const report = await runEvaluationReport({ outputPath });
  const saved = JSON.parse(await readFile(outputPath, "utf8"));
  const markdown = await readFile(join(root, "report.md"), "utf8");
  assert.equal(saved.summary.passed, 28);
  assert.equal(report.teachingSplits.calibration.expected, 12);
  assert.equal(report.teachingSplits.holdout.expected, 12);
  assert.equal(report.pendingLabels, 24);
  assert.equal(report.gate.pass, false);
  assert.ok(report.gate.failures.filter(row => row.code === "CASE_MISSING").length >= 24);
  assert.match(markdown, /calibration: 0\/12 completed/);
  assert.match(markdown, /holdout: 0\/12 completed/);
});

test("report CLI consumes only a model report bound to the current teaching dataset", async t => {
  const { runEvaluationReport } = await import("../scripts/eval-report.mjs");
  const root = await workspace(t);
  const datasetPath = new URL("../evals/datasets/teaching.jsonl", import.meta.url);
  const datasetBytes = await readFile(datasetPath);
  const datasetDigest = `sha256:${createHash("sha256").update(datasetBytes).digest("hex")}`;
  const modelReportPath = join(root, "model-report.json");
  await writeFile(modelReportPath, JSON.stringify({ datasetDigest, results: [
    { caseId: "teach-ru-beginner-normal-lesson", split: "calibration", status: "completed", passed: true },
    { caseId: "teach-en-experienced-resume", split: "holdout", status: "error" },
  ] }));
  const report = await runEvaluationReport({ outputPath: join(root, "report.json"), modelReportPath });
  assert.equal(report.summary.passed, 29);
  assert.equal(report.summary.error, 1);
  assert.equal(report.teachingSplits.calibration.completed, 1);
  assert.equal(report.teachingSplits.holdout.completed, 0);
  assert.equal(report.gate.pass, false);

  await writeFile(modelReportPath, JSON.stringify({ datasetDigest: "sha256:stale", results: [
    { caseId: "teach-en-experienced-resume", split: "holdout", status: "completed", passed: true },
  ] }));
  const stale = await runEvaluationReport({ outputPath: join(root, "stale-report.json"), modelReportPath });
  assert.equal(stale.summary.passed, 28);
  assert.ok(stale.gate.failures.some(row => row.caseId === "teach-en-experienced-resume" && row.code === "CASE_MISSING"));
});
