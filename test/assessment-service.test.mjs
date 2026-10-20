import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assessAndPersist } from "../src/assessment-service.mjs";
import { composeCheckpoint, assessCheckpoint, resetCheckpointsForTests } from "../src/checkpoints.mjs";
import { saveLearningState } from "../src/progress.mjs";

test.beforeEach(() => resetCheckpointsForTests());

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "loom-assessment-"));
  t.context = root;
  await saveLearningState(root, { sessionId: "s1", topic: "Topic", goal: "Goal", phase: "build", currentStep: "Concept", nextStep: "Practice" });
  return root;
}

function card() { return composeCheckpoint({ prompt: "Choose", choices: [{ key: "a", label: "A" }, { key: "b", label: "B" }], expected: "a", rationale: "A" }); }

test("invalid answer does not consume the card", () => {
  const value = card();
  assert.throws(() => assessCheckpoint({ token: value.token, selected: "missing" }), /does not exist/);
  assert.equal(assessCheckpoint({ token: value.token, selected: "a" }).outcome, "accurate");
});

test("assessment receipt makes a retry idempotent across restarts", async (t) => {
  const root = await setup(t); const value = card();
  const input = { token: value.token, selected: "a", sessionId: "s1", nextStep: "Continue", attemptId: "attempt-1" };
  const first = await assessAndPersist(root, input);
  resetCheckpointsForTests();
  const retry = await assessAndPersist(root, input);
  assert.equal(retry.replayed, true);
  assert.equal(retry.learningState.revision, first.learningState.revision);
  const state = JSON.parse(await readFile(join(root, ".concept-loom", "sessions", "s1.json"), "utf8"));
  assert.equal(state.evidence.Concept.attempts, 1);
});

test("same attempt id with changed input conflicts", async (t) => {
  const root = await setup(t); const value = card();
  await assessAndPersist(root, { token: value.token, selected: "a", sessionId: "s1", nextStep: "Continue", attemptId: "attempt-2" });
  await assert.rejects(assessAndPersist(root, { token: value.token, selected: "b", sessionId: "s1", nextStep: "Continue", attemptId: "attempt-2" }), { code: "ATTEMPT_CONFLICT" });
});

test("hinted correct answers do not extend unaided review streak", async (t) => {
  const root = await setup(t); const value = card();
  const result = await assessAndPersist(root, { token: value.token, selected: "a", hintUsed: true, sessionId: "s1", nextStep: "Continue", attemptId: "attempt-3" });
  assert.equal(result.learningState.evidence.Concept.consecutiveSuccesses, 0);
  assert.equal(result.learningState.evidence.Concept.hintUsed, true);
});
