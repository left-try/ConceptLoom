import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createExercise, getExercise, submitPractice, assessPractice } from "../src/practice/model.mjs";
import { saveLearningState, loadLearningState } from "../src/progress.mjs";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "loom-practice-"));
  const exercise = await createExercise(root, { uid: "choose-isolation", courseUid: "transactions", lessonUid: "isolation-levels", kind: "scenario", publicSpec: { task: "Choose a level for this workload.", prompt: "What tradeoff matters?" }, privateCriteria: ["Names read anomalies", "Connects the workload to a risk"] });
  return { root, exercise };
}

test("public exercise omits private grading criteria", async () => {
  const { root, exercise } = await setup();
  const visible = await getExercise(root, { uid: exercise.uid });
  assert.doesNotMatch(JSON.stringify(visible), /Names read anomalies/);
  assert.match(await readFile(join(root, ".concept-loom", "practice", exercise.uid, "private.json"), "utf8"), /Names read anomalies/);
});

test("practice submission is idempotent and changed input conflicts", async () => {
  const { root, exercise } = await setup();
  const input = { attemptId: "attempt-a", exerciseUid: exercise.uid, exerciseRevision: exercise.revision, response: "Serializable prevents the observed anomaly.", hintUsed: true };
  const first = await submitPractice(root, input); const retry = await submitPractice(root, input);
  assert.deepEqual(retry, first);
  await assert.rejects(submitPractice(root, { ...input, response: "Changed answer" }), { code: "ATTEMPT_CONFLICT" });
});

test("rejects stale exercise revision without recording an attempt", async () => {
  const { root, exercise } = await setup();
  await assert.rejects(submitPractice(root, { attemptId: "stale-attempt", exerciseUid: exercise.uid, exerciseRevision: 9, response: "answer" }), { code: "EXERCISE_REVISION_CONFLICT" });
});

test("feedback references a submitted response and records hints and rubric version", async () => {
  const { root, exercise } = await setup();
  const submitted = await submitPractice(root, { attemptId: "feedback-attempt", exerciseUid: exercise.uid, exerciseRevision: exercise.revision, response: "I chose serializable after a hint.", hintUsed: true, confidence: 70 });
  const assessed = await assessPractice(root, { attemptId: submitted.attemptId, rubricVersion: "rubric-1", verdict: "partial", criterionResults: [{ criterion: "Names read anomalies", result: "met" }, { criterion: "Connects the workload to a risk", result: "partial" }], feedback: "You identified anomalies; connect that risk to the workload's concurrent writes.", nextStep: "Try a transfer example." });
  assert.equal(assessed.response, submitted.response);
  assert.equal(assessed.unaided, false);
  assert.equal(assessed.rubricVersion, "rubric-1");
  assert.match(assessed.feedback, /concurrent writes/);
});

test("assessment records practice evidence in the shared learning ledger atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-practice-ledger-"));
  await saveLearningState(root, { sessionId: "learning-1", topic: "Transactions", goal: "Explain isolation", phase: "weave", currentStep: "isolation", nextStep: "Practice a transfer example" });
  const exercise = await createExercise(root, { uid: "ledger-exercise", courseUid: "transactions", lessonUid: "isolation-levels", sessionId: "learning-1", evidenceConcept: "isolation levels", kind: "scenario", publicSpec: { task: "Choose a level." }, privateCriteria: ["Connects the level to a risk"] });
  const submitted = await submitPractice(root, { attemptId: "ledger-attempt", exerciseUid: exercise.uid, exerciseRevision: exercise.revision, response: "Serializable avoids this anomaly.", hintUsed: true });
  const assessed = await assessPractice(root, { attemptId: submitted.attemptId, rubricVersion: "rubric-1", verdict: "accurate", criterionResults: [{ criterion: "Connects the level to a risk", result: "met" }], feedback: "You connected the level to the risk.", nextStep: "Try an unaided review tomorrow." });
  const { state } = await loadLearningState(root, { sessionId: "learning-1" });
  assert.equal(state.evidence["isolation levels"].attempts, 1);
  assert.equal(state.evidence["isolation levels"].successes, 1);
  assert.equal(state.evidence["isolation levels"].consecutiveSuccesses, 0);
  assert.equal(assessed.captureDiagnostics.length, 0);
  const evidence = JSON.parse(await readFile(join(root, ".concept-loom", "assessments", "attempts", "ledger-attempt.json"), "utf8"));
  assert.equal(evidence.learningStateRevision, state.revision);
});
