import test from "node:test";
import assert from "node:assert/strict";
import { createExercise, getExercise, submitPractice, assessPractice } from "../src/practice/tools.mjs";
import { makePracticeWorkspace, publicSpec, privateCriteria, readWorkspaceFiles } from "./helpers/practice.mjs";

async function createSample(root) {
  return createExercise(root, {
    uid: "transaction-ordering",
    lessonUid: "atomic-updates",
    kind: "scenario",
    publicSpec,
    privateCriteria,
  });
}

test("public exercise read excludes private grading criteria", async t => {
  const root = await makePracticeWorkspace(t);
  await createSample(root);

  const exercise = await getExercise(root, { uid: "transaction-ordering" });

  assert.equal(exercise.uid, "transaction-ordering");
  assert.equal(exercise.lessonUid, "atomic-updates");
  assert.equal(exercise.publicSpec.title, publicSpec.title);
  assert.doesNotMatch(JSON.stringify(exercise), /private-answer-marker|private-rubric-marker/);
});

test("retrying an identical practice attempt returns the same receipt", async t => {
  const root = await makePracticeWorkspace(t);
  const exercise = await createSample(root);
  const input = {
    attemptId: "attempt-once",
    exerciseUid: exercise.uid,
    exerciseRevision: exercise.revision,
    response: { choice: "serialize-writes", reasoning: "Compare and swap the revision." },
    artifacts: [],
    hintUsed: false,
  };

  const first = await submitPractice(root, input);
  const retry = await submitPractice(root, input);

  assert.deepEqual(retry, first);
});

test("reusing an attempt ID with changed input conflicts without replacing the saved response", async t => {
  const root = await makePracticeWorkspace(t);
  const exercise = await createSample(root);
  const base = {
    attemptId: "attempt-conflict",
    exerciseUid: exercise.uid,
    exerciseRevision: exercise.revision,
    response: { choice: "serialize-writes", reasoning: "First answer." },
  };
  const first = await submitPractice(root, base);

  await assert.rejects(
    submitPractice(root, { ...base, response: { choice: "retry", reasoning: "Changed answer." } }),
    error => error.code === "ATTEMPT_CONFLICT",
  );

  const files = await readWorkspaceFiles(root);
  assert.ok(files.some(file => file.text.includes("First answer.")));
  assert.equal(files.some(file => file.text.includes("Changed answer.")), false);
  assert.ok(first.attemptId);
});

test("submission for an obsolete exercise revision is rejected", async t => {
  const root = await makePracticeWorkspace(t);
  await createSample(root);

  await assert.rejects(
    submitPractice(root, {
      attemptId: "stale-attempt",
      exerciseUid: "transaction-ordering",
      exerciseRevision: "obsolete-revision",
      response: "answer",
    }),
    error => error.code === "EXERCISE_REVISION_CONFLICT",
  );
});

test("assessment records evidence for the submitted response and exact rubric revision", async t => {
  const root = await makePracticeWorkspace(t);
  const exercise = await createSample(root);
  const response = { choice: "serialize-writes", reasoning: "Check the expected revision under lock." };
  const submitted = await submitPractice(root, {
    attemptId: "assessed-attempt",
    exerciseUid: exercise.uid,
    exerciseRevision: exercise.revision,
    response,
    hintUsed: true,
    confidence: 72,
  });

  const assessed = await assessPractice(root, {
    attemptId: submitted.attemptId,
    rubricVersion: "rubric-1",
    verdict: "accurate",
    criterionResults: [{ criterionId: "atomicity", result: "met", evidence: response.reasoning }],
    nextStep: "Explain why a stale revision must not overwrite the winner.",
  });

  assert.equal(assessed.attemptId, submitted.attemptId);
  assert.equal(assessed.exerciseRevision, exercise.revision);
  assert.equal(assessed.rubricVersion, "rubric-1");
  assert.deepEqual(assessed.response, response);
  assert.equal(assessed.criterionResults[0].evidence, response.reasoning);
});

test("an invalid assessment request does not erase the already saved learner response", async t => {
  const root = await makePracticeWorkspace(t);
  const exercise = await createSample(root);
  const response = { reasoning: "I need another attempt." };
  await submitPractice(root, {
    attemptId: "feedback-failure",
    exerciseUid: exercise.uid,
    exerciseRevision: exercise.revision,
    response,
  });

  await assert.rejects(assessPractice(root, {
    attemptId: "unknown-attempt",
    rubricVersion: "rubric-1",
    verdict: "accurate",
    criterionResults: [],
    nextStep: "Continue.",
  }));

  const files = await readWorkspaceFiles(root);
  assert.ok(files.some(file => file.text.includes("I need another attempt.")));
});
