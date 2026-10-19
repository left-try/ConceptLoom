import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { composeCheckpoint } from "../src/checkpoints.mjs";
import { assessAndPersist } from "../src/assessment-service.mjs";
import { loadLearningState, saveLearningState } from "../src/progress.mjs";
import { createToolRegistry } from "../src/tool-registry.mjs";

const url = new URL("../src/evaluation/capture.mjs", import.meta.url);
const outbox = ".concept-loom/evaluation/events.jsonl";
const timestamp = "2026-10-12T08:00:00.000Z";
const event = overrides => ({ schemaVersion: 1, eventId: "event-1", eventType: "practice-assessed", timestamp, host: "other", sessionId: "lesson", input: { attemptId: "attempt-1", format: "choice", hintUsed: false }, output: { outcome: "accurate", revision: 2 }, ...overrides });
async function api() {
  const module = await import(url.href).catch(error => { if (error.code === "ERR_MODULE_NOT_FOUND") return {}; throw error; });
  assert.equal(typeof module.captureEvent, "function", "local capture contracts must exist");
  return module;
}
async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), "loom-capture-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function events(root) { return (await fs.readFile(join(root, outbox), "utf8")).trim().split("\n").map(line => JSON.parse(line)); }
async function assessmentInput(root) {
  await saveLearningState(root, { sessionId: "lesson", topic: "Transactions", goal: "Learn atomicity", phase: "build", route: ["Atomicity"], nextStep: "Answer" });
  const card = composeCheckpoint({ prompt: "Choose", choices: [{ key: "a", label: "All" }, { key: "b", label: "Some" }], expected: "a", rationale: "PRIVATE-RATIONALE", mix: false });
  return { token: card.token, sessionId: "lesson", attemptId: "attempt-1", selected: "a", nextStep: "Transfer", evidenceConcept: "Atomicity", note: "PRIVATE-NOTE" };
}

test("duplicate event recorded once across concurrent calls", async t => {
  const { captureEvent } = await api(), root = await fixture(t);
  const results = await Promise.all(Array.from({ length: 10 }, () => captureEvent(root, event())));
  assert.equal(results.filter(result => result.recorded).length, 1);
  assert.ok(results.every(result => result.diagnostics.length === 0));
  assert.deepEqual(await events(root), [event()]);
  const conflict = await captureEvent(root, event({ output: { outcome: "needs-repair", revision: 2 } }));
  assert.equal(conflict.recorded, false);
  assert.equal(conflict.diagnostics[0].code, "CAPTURE_EVENT_CONFLICT");
});

test("append lock serializes separate processes without losing or duplicating events", async t => {
  await api();
  const root = await fixture(t);
  const code = `import {captureEvent} from ${JSON.stringify(url.href)}; const result = await captureEvent(process.argv[1], JSON.parse(process.argv[2])); if(result.diagnostics.length) throw new Error(JSON.stringify(result));`;
  await Promise.all(["shared", "shared", "other"].map(eventId => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, root, JSON.stringify(event({ eventId }))]);
    let stderr = "";
    child.stderr.on("data", bytes => { stderr += bytes; });
    child.on("error", reject);
    child.on("close", status => status === 0 ? resolve() : reject(new Error(stderr)));
  })));
  assert.deepEqual((await events(root)).map(row => row.eventId).sort(), ["other", "shared"]);
});

test("private fields excluded recursively and receipt content is never forwarded", async t => {
  const { captureEvent } = await api(), root = await fixture(t);
  const secret = { expected: "PRIVATE-EXPECTED", rationale: "PRIVATE-RATIONALE", criteria: ["PRIVATE-CRITERIA"], hiddenReasoning: "PRIVATE-REASONING", response: "PRIVATE-RESPONSE", receipt: { expected: "PRIVATE-NESTED" } };
  assert.equal((await captureEvent(root, event({ ...secret, input: { ...event().input, ...secret }, output: { ...event().output, ...secret }, artifacts: [{ path: "lessons/one.md", contentHash: `sha256:${"a".repeat(64)}`, ...secret }] }))).recorded, true);
  const recorded = await events(root);
  assert.doesNotMatch(JSON.stringify(recorded), /PRIVATE|expected|rationale|criteria|hiddenReasoning|receipt|response/);
  assert.deepEqual(recorded[0].input, event().input);
  assert.deepEqual(recorded[0].artifacts, [{ path: "lessons/one.md", contentHash: `sha256:${"a".repeat(64)}` }]);
});

test("unknown usage stays absent and inferred token usage is excluded", async t => {
  const { captureEvent } = await api(), root = await fixture(t);
  await captureEvent(root, event());
  await captureEvent(root, event({ eventId: "inferred", tokenUsage: { source: "estimated", inputTokens: 200 }, toolDurationMs: 42 }));
  await captureEvent(root, event({ eventId: "reported", model: "provider-model", tokenUsage: { source: "provider-reported", inputTokens: 10, outputTokens: 5 }, generationLatencyMs: 15 }));
  const rows = await events(root);
  for (const row of rows.slice(0, 2)) {
    assert.equal(Object.hasOwn(row, "tokenUsage"), false);
    assert.equal(Object.hasOwn(row, "generationLatencyMs"), false);
  }
  assert.deepEqual(rows[2].tokenUsage, { source: "provider-reported", inputTokens: 10, outputTokens: 5 });
  assert.equal(rows[2].generationLatencyMs, 15);
});

test("critical schema invalidity reports an error and never records a pass", async t => {
  const { captureEvent, validateContract } = await api(), root = await fixture(t);
  for (const bad of [event({ schemaVersion: 2 }), event({ timestamp: "yesterday" }), event({ eventType: "unknown" }), event({ output: { outcome: "passed", revision: -1 } })]) {
    assert.equal(validateContract("capture-event", bad).valid, false);
    const result = await captureEvent(root, bad);
    assert.equal(result.recorded, false);
    assert.equal(result.diagnostics[0].severity, "error");
    assert.equal(result.diagnostics[0].code, "CAPTURE_INVALID");
  }
  assert.equal(validateContract("capture-event", { ...event(), expected: "secret" }).valid, false);
  assert.equal(validateContract("missing", {}).valid, false);
  assert.equal(validateContract("capture-event", event()).valid, true);
  await assert.rejects(fs.readFile(join(root, outbox)), { code: "ENOENT" });
});

test("eval results require evaluator identity and distinguish completed/error/skipped", async () => {
  const { validateContract } = await api();
  const base = { schemaVersion: 1, resultId: "result-1", eventId: "event-1", evaluatorId: "contracts", evaluatorVersion: "1", timestamp };
  for (const result of [{ ...base, status: "completed", passed: true }, { ...base, status: "completed", passed: false }, { ...base, status: "error", diagnostics: [{ severity: "error", code: "INVALID_CONTRACT" }] }, { ...base, status: "skipped" }]) assert.equal(validateContract("eval-result", result).valid, true, JSON.stringify(result));
  for (const result of [{ ...base, status: "completed" }, { ...base, status: "error", passed: true }, { ...base, status: "skipped", passed: true }, { ...base, status: "completed", passed: true, evaluatorVersion: "" }, { ...base, status: "completed", passed: true, rationale: { expected: "private" } }]) assert.equal(validateContract("eval-result", result).valid, false, JSON.stringify(result));
});

test("shared CaptureEvent requires every canonical core field and permits empty factual input/output", async t => {
  const { captureEvent, validateContract } = await api(), root = await fixture(t);
  const minimal = { schemaVersion: 1, eventId: "minimal", eventType: "state-restored", timestamp, host: "other", input: {}, output: {} };
  assert.equal(validateContract("capture-event", minimal).valid, true);
  for (const field of ["schemaVersion", "eventId", "eventType", "timestamp", "host", "input", "output"]) {
    const incomplete = { ...minimal };
    delete incomplete[field];
    assert.equal(validateContract("capture-event", incomplete).valid, false, field);
    assert.equal((await captureEvent(root, incomplete)).diagnostics[0]?.code, "CAPTURE_INVALID", field);
  }
  for (const eventType of ["research-completed", "roadmap-proposed", "lesson-published", "source-prepared", "knowledge-updated", "practice-assessed", "state-restored", "dispatch-result"]) assert.equal(validateContract("capture-event", { ...minimal, eventType }).valid, true, eventType);
  assert.equal((await captureEvent(root, minimal)).recorded, true);
  assert.deepEqual(await events(root), [minimal]);
});

test("shared CaptureEvent schema and projection preserve canonical optional names", async t => {
  const { captureEvent, validateContract } = await api(), root = await fixture(t);
  const value = event({ parentId: "parent", runId: "run", courseUid: "course", lessonUid: "lesson-uid", nodeUid: "node", host: "codex", promptId: "practice", promptDigest: `sha256:${"a".repeat(64)}`, knowledgeProfileVersion: "knowledge/1", sourceHashes: [`sha256:${"b".repeat(64)}`], model: "provider-model", tokenUsage: { source: "provider-reported", inputTokens: 1 }, generationLatencyMs: 10 });
  assert.equal(validateContract("capture-event", value).valid, true);
  for (const name of ["parentId", "runId", "courseUid", "lessonUid", "nodeUid", "host", "promptId", "promptDigest", "knowledgeProfileVersion", "model"]) assert.equal(validateContract("capture-event", { ...value, [name]: 9 }).valid, false, name);
  for (const renamed of ["parentEventId", "courseId", "lessonId", "nodeId"]) assert.equal(validateContract("capture-event", { ...value, [renamed]: "legacy" }).valid, false, renamed);
  assert.equal((await captureEvent(root, { ...value, parentEventId: "legacy", courseId: "legacy", lessonId: "legacy", nodeId: "legacy", rationale: "PRIVATE" })).recorded, true);
  assert.deepEqual(await events(root), [value]);
});

test("shared EvalResult supports typed optional scores dimensions rationale and diagnostics without changing capture privacy", async t => {
  const { captureEvent, validateContract } = await api(), root = await fixture(t);
  const result = { schemaVersion: 1, resultId: "result-1", eventId: "event-1", evaluatorId: "contracts", evaluatorVersion: "1", timestamp, status: "completed", passed: true, score: 0.9, dimensions: { mechanism: 3, example: 2, level: 2, grounding: 3 }, rationale: "Observed artifact satisfies the explanation contract.", diagnostics: [{ severity: "info", code: "CONTRACT_VALID", message: "Required sections found." }] };
  assert.equal(validateContract("eval-result", result).valid, true);
  for (const field of ["schemaVersion", "resultId", "eventId", "evaluatorId", "evaluatorVersion", "timestamp", "status", "passed"]) {
    const incomplete = { ...result };
    delete incomplete[field];
    assert.equal(validateContract("eval-result", incomplete).valid, false, field);
  }
  for (const invalid of [{ score: "0.9" }, { dimensions: [] }, { dimensions: { mechanism: 4 } }, { dimensions: { mechanism: { criteria: "private" } } }, { rationale: { hiddenReasoning: "private" } }, { diagnostics: [{ severity: "info", code: "OK", message: { criteria: "private" } }] }, { criteria: ["private"] }, { expected: "private" }, { hiddenReasoning: "private" }]) assert.equal(validateContract("eval-result", { ...result, ...invalid }).valid, false, JSON.stringify(invalid));
  assert.equal(validateContract("capture-event", event({ rationale: result.rationale })).valid, false);
  await captureEvent(root, event({ score: result.score, dimensions: result.dimensions, rationale: "PRIVATE-EVAL-RATIONALE", diagnostics: result.diagnostics }));
  assert.deepEqual(await events(root), [event()]);
});

test("restore capture recovers original event facts after the committed session advances", async t => {
  const root = await fixture(t);
  await assessmentInput(root);
  await fs.writeFile(join(root, ".concept-loom/evaluation"), "blocked");
  const registry = createToolRegistry(root, { host: "codex", evaluationTools: true });
  const original = (await registry.invoke("loom_load_learning_state", { sessionId: "lesson" })).structuredContent;
  assert.equal(original.capture.diagnostics[0].severity, "error");
  await saveLearningState(root, { sessionId: "lesson", phase: "review", nextStep: "PRIVATE-FUTURE-STEP", learnerContext: "PRIVATE-LEARNER-CONTEXT" });
  const advanced = await fs.readFile(join(root, ".concept-loom/sessions/lesson.json"), "utf8");
  assert.equal(JSON.parse(advanced).revision, 2);
  await fs.rm(join(root, ".concept-loom/evaluation"));
  assert.equal(typeof original.capture.receiptPath, "string", "restore capture requires a durable factual receipt");
  const descriptor = JSON.parse(await fs.readFile(join(root, original.capture.receiptPath), "utf8"));
  assert.equal(descriptor.event.eventId, original.capture.eventId);
  assert.equal(descriptor.event.timestamp, original.capture.timestamp);
  const recovered = (await registry.invoke("loom_recover_capture", { eventId: original.capture.eventId })).structuredContent;
  assert.equal(recovered.recorded, true, JSON.stringify(recovered));
  assert.deepEqual(await events(root), [{ schemaVersion: 1, eventId: original.capture.eventId, eventType: "state-restored", timestamp: original.capture.timestamp, host: "codex", sessionId: "lesson", status: "completed", input: {}, output: { revision: 1, phase: "build" } }]);
  assert.equal((await registry.invoke("loom_recover_capture", { eventId: original.capture.eventId })).structuredContent.recorded, false);
  assert.equal(await fs.readFile(join(root, ".concept-loom/sessions/lesson.json"), "utf8"), advanced);
  assert.doesNotMatch(JSON.stringify(descriptor), /PRIVATE|learnerContext|nextStep|expected|criteria|rationale/);
});

test("assessment producers preserve truthful configured host in committed capture and receipt recovery", async t => {
  const { recoverCapture } = await api(), root = await fixture(t), input = await assessmentInput(root);
  await fs.writeFile(join(root, ".concept-loom/evaluation"), "blocked");
  await createToolRegistry(root, { host: "claude-code" }).invoke("loom_assess_checkpoint", input);
  await fs.rm(join(root, ".concept-loom/evaluation"));
  await recoverCapture(root, { attemptId: input.attemptId });
  assert.equal((await events(root))[0].host, "claude-code");
  const plain = await fixture(t), plainInput = await assessmentInput(plain);
  await assessAndPersist(plain, plainInput);
  assert.equal((await events(plain))[0].host, "other");
});

test("restore receipt storage failure is visible and cannot block later learning transactions", async t => {
  const root = await fixture(t);
  await assessmentInput(root);
  await fs.writeFile(join(root, ".concept-loom/capture"), "blocked");
  const loaded = (await createToolRegistry(root).invoke("loom_load_learning_state", { sessionId: "lesson" })).structuredContent;
  assert.equal(loaded.state.revision, 1);
  assert.equal(loaded.capture.diagnostics[0].code, "CAPTURE_RECEIPT_WRITE_FAILED");
  const updated = await saveLearningState(root, { sessionId: "lesson", nextStep: "Continue", phase: "review" });
  assert.equal(updated.revision, 2);
  assert.equal(updated.phase, "review");
});

test("error diagnostics cannot be counted as a passing evaluation", async () => {
  const { validateContract } = await api();
  const result = { schemaVersion: 1, resultId: "result-1", eventId: "event-1", evaluatorId: "contracts", evaluatorVersion: "1", timestamp, status: "completed", passed: true, diagnostics: [{ severity: "error", code: "INVALID_CONTRACT" }] };
  assert.equal(validateContract("eval-result", result).valid, false);
  assert.equal(validateContract("eval-result", { ...result, passed: false }).valid, true);
});

test("outbox failure does not undo committed assessment and exposes its recovery pointer", async t => {
  const root = await fixture(t), input = await assessmentInput(root);
  await fs.writeFile(join(root, ".concept-loom/evaluation"), "blocked");
  const result = await assessAndPersist(root, input);
  assert.equal(result.learningState.evidence.Atomicity.attempts, 1);
  assert.equal(result.capture?.diagnostics[0].severity, "error", "outbox diagnostic must be visible");
  assert.equal(result.capture.eventId, "practice-attempt-1");
  assert.equal(result.capture.receiptPath, ".concept-loom/assessments/attempts/attempt-1.json");
  const receipt = JSON.parse(await fs.readFile(join(root, result.capture.receiptPath), "utf8"));
  assert.equal(receipt.capture.eventId, result.capture.eventId);
  assert.equal(receipt.capture.outboxPath, outbox);
  assert.equal((await loadLearningState(root, { sessionId: "lesson" })).state.revision, 2);
  await assert.rejects(assessAndPersist(root, { ...input, attemptId: "second" }), /unknown or expired/);
});

test("recover capture from receipt after restart without regrading or exposing private material", async t => {
  const { recoverCapture } = await api(), root = await fixture(t), input = await assessmentInput(root);
  await fs.writeFile(join(root, ".concept-loom/evaluation"), "blocked");
  await assessAndPersist(root, input);
  await fs.rm(join(root, ".concept-loom/evaluation"));
  const before = await fs.readFile(join(root, ".concept-loom/sessions/lesson.json"), "utf8");
  assert.equal((await recoverCapture(root, { attemptId: input.attemptId })).recorded, true);
  assert.equal((await recoverCapture(root, { attemptId: input.attemptId })).recorded, false);
  const recovered = await events(root);
  assert.equal(recovered[0].eventId, "practice-attempt-1");
  assert.equal(recovered[0].output.outcome, "accurate");
  assert.doesNotMatch(JSON.stringify(recovered), /PRIVATE|expected|rationale|criteria|token"|selected|learningState/);
  assert.equal(await fs.readFile(join(root, ".concept-loom/sessions/lesson.json"), "utf8"), before);
  assert.equal((await assessAndPersist(root, input)).learningState.evidence.Atomicity.attempts, 1);
  assert.equal((await events(root)).length, 1);
  for (const attemptId of ["missing", "../outside"]) {
    const result = await recoverCapture(root, { attemptId });
    assert.equal(result.recorded, false);
    assert.equal(result.diagnostics[0].severity, "error");
  }
});

test("assessment tool propagates capture diagnostics through MCP structured and text content", async t => {
  const root = await fixture(t), input = await assessmentInput(root);
  await fs.writeFile(join(root, ".concept-loom/evaluation"), "blocked");
  const result = await createToolRegistry(root).invoke("loom_assess_checkpoint", input);
  assert.equal(result.structuredContent.capture?.diagnostics[0].severity, "error");
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal(result.structuredContent.learningState.revision, 2);
});

test("state-restored capture contains committed factual fields and preserves successful load on outbox error", async t => {
  const root = await fixture(t);
  await assessmentInput(root);
  const registry = createToolRegistry(root);
  const restored = await registry.invoke("loom_load_learning_state", { sessionId: "lesson" });
  const recorded = await events(root);
  assert.equal(recorded[0].eventType, "state-restored");
  assert.equal(recorded[0].output.revision, 1);
  assert.equal(recorded[0].output.phase, "build");
  assert.equal(recorded[0].sessionId, restored.structuredContent.state.sessionId);
  await fs.rm(join(root, ".concept-loom/evaluation"), { recursive: true });
  await fs.writeFile(join(root, ".concept-loom/evaluation"), "blocked");
  const retry = (await registry.invoke("loom_load_learning_state", { sessionId: "lesson" })).structuredContent;
  assert.equal(retry.state.revision, 1);
  assert.equal(retry.capture.diagnostics[0].severity, "error");
});

test("evaluation tools are optional and lesson publication cannot be claimed by general capture", async t => {
  const { captureEvent, tools } = await api(), root = await fixture(t);
  const core = createToolRegistry(root);
  assert.ok(core.catalog.some(tool => tool.name === "loom_create_exercise"));
  assert.ok(core.catalog.some(tool => tool.name === "loom_open_learning_view"));
  const extended = createToolRegistry(root, { evaluationTools: true });
  assert.ok(extended.catalog.length > core.catalog.length);
  assert.ok(extended.catalog.some(tool => tool.name === "loom_recover_capture"));
  assert.equal(typeof tools(root)[0].invoke, "function");
  const validation = await extended.invoke("loom_validate_contract", { name: "capture-event", value: event() });
  assert.equal(validation.structuredContent.valid, true);
  const denied = await captureEvent(root, event({ eventType: "lesson-published" }));
  assert.equal(denied.recorded, false);
  assert.equal(denied.diagnostics[0].code, "CAPTURE_REQUIRES_ARTIFACT");
  const input = await assessmentInput(root);
  await createToolRegistry(root, { capture: false }).invoke("loom_assess_checkpoint", input);
  await core.invoke("loom_show_text_diagram", { source: "A -> B" });
  await assert.rejects(fs.readFile(join(root, outbox)), { code: "ENOENT" });
});

test("malformed outbox is visible and cannot silently discard recorded evidence", async t => {
  const { captureEvent } = await api(), root = await fixture(t);
  await fs.mkdir(join(root, ".concept-loom/evaluation"), { recursive: true });
  const corrupt = `${JSON.stringify(event())}\n{"unfinished":`;
  await fs.writeFile(join(root, outbox), corrupt);
  const result = await captureEvent(root, event({ eventId: "second" }));
  assert.equal(result.recorded, false);
  assert.equal(result.diagnostics[0].code, "CAPTURE_OUTBOX_INVALID");
  assert.equal(await fs.readFile(join(root, outbox), "utf8"), corrupt);
});

test("the initial eight structural fixtures execute against their real originating modules", async t => {
  await api();
  const ledger = JSON.parse(await fs.readFile(new URL("fixtures/contracts/ledger.json", import.meta.url), "utf8"));
  assert.equal(ledger.plannedStructuralCases, 24);
  const executableCases = ledger.cases.filter(row => row.executable === true);
  assert.equal(executableCases.length, 8);
  assert.equal(new Set(ledger.cases.map(row => row.id)).size, 24);
  for (const row of executableCases) {
    assert.ok(row.origin.file && row.origin.test);
    const value = JSON.parse(await fs.readFile(new URL(`fixtures/contracts/${row.fixture}`, import.meta.url), "utf8"));
    const root = await fixture(t);
    if (value.kind === "state") {
      await saveLearningState(root, value.initial);
      const state = await saveLearningState(root, value.patch);
      for (const [key, expected] of Object.entries(value.expected)) assert.deepEqual(state[key], expected, row.id);
    } else if (value.kind === "cards") {
      const card = composeCheckpoint(value.input);
      for (const key of value.absent) assert.equal(Object.hasOwn(card, key), false, row.id);
    } else if (value.kind === "opf") {
      const { parsePrompt, renderPrompt } = await import("../src/prompts/loader.mjs");
      assert.deepEqual(renderPrompt(parsePrompt(value.source), value.inputs).messages, value.expected, row.id);
    } else if (value.kind === "diagrams") {
      const { renderRelationMap } = await import("../src/diagrams.mjs");
      if (value.error) assert.throws(() => renderRelationMap(value.input), new RegExp(value.error), row.id);
      else assert.match(renderRelationMap(value.input).source, new RegExp(value.expectedPattern), row.id);
    } else if (value.kind === "capture") {
      const { captureEvent, validateContract } = await api();
      assert.equal(validateContract(value.contract, value.input).valid, value.valid, row.id);
      if (value.expected) { await captureEvent(root, value.input); assert.deepEqual(await events(root), [value.expected], row.id); }
    } else assert.fail(`unsupported fixture ${row.id}`);
  }
});
