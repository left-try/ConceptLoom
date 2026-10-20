import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureEvent, recoverCaptureFromReceipt, validateContract } from "../src/evaluation/capture.mjs";

test("deduplicates public events and strips private assessment fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-capture-"));
  const event = { eventId: "attempt-a", kind: "practice-assessed", attemptId: "a", outcome: "accurate", criteria: ["secret"], expected: "private", hiddenReasoning: "secret" };
  assert.deepEqual(await captureEvent(root, event), { recorded: true, diagnostics: [] });
  assert.equal((await captureEvent(root, event)).duplicate, true);
  const saved = await readFile(join(root, ".concept-loom", "evaluation", "events.jsonl"), "utf8");
  assert.doesNotMatch(saved, /criteria|expected|hiddenReasoning|secret|private/);
  assert.doesNotMatch(saved, /tokenUsage/);
});

test("invalid capture and evaluation contracts return diagnostics", () => {
  assert.equal(validateContract("capture-event", { eventId: "x", kind: "unknown" }).valid, false);
  assert.equal(validateContract("eval-result", { caseId: "x", status: "skipped", dimensions: { safety: "pass" } }).valid, true);
});

test("reconstructs capture from a committed attempt receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-capture-"));
  const result = await recoverCaptureFromReceipt(root, { attemptId: "attempt-b", courseUid: "course", lessonUid: "lesson", verdict: "partial" });
  assert.equal(result.recorded, true);
});
