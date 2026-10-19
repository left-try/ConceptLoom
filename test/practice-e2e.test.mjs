import test from "node:test";
import assert from "node:assert/strict";
import { createExercise, getExercise, submitPractice, assessPractice } from "../src/practice/tools.mjs";
import { buildLearningView } from "../src/ui/views.mjs";
import { createScenarioState, applyScenarioAction, exportScenarioAttempt } from "../src/practice/scenarios.mjs";
import { makePracticeWorkspace, publicSpec, privateCriteria } from "./helpers/practice.mjs";

test("learner can complete a scenario through text fallback and resume the same durable attempt", async t => {
  const root = await makePracticeWorkspace(t, {
    "vault/Knowledge/index.md": "---\nokf_version: \"0.2\"\n---\n# Knowledge\n",
  });
  const exercise = await createExercise(root, {
    uid: "transaction-ordering",
    lessonUid: "atomic-updates",
    kind: "scenario",
    publicSpec,
    privateCriteria,
  });
  const view = await buildLearningView(root, {
    lessonUid: "atomic-updates",
    focusUid: "atomicity",
    capabilities: { mcpAppUi: false },
  });
  const scenarioSpec = {
    exerciseUid: exercise.uid,
    exerciseRevision: exercise.revision,
    initialState: { status: "start" },
    actions: ["inspect", "compare"],
    transitions: { start: { inspect: "inspected" }, inspected: { compare: "complete" } },
  };
  const state = applyScenarioAction(
    applyScenarioAction(createScenarioState(scenarioSpec, { seed: 42 }), { type: "inspect", reasoning: "Read the current revision." }),
    { type: "compare", reasoning: "Commit only if the revision is unchanged." },
  );
  const response = exportScenarioAttempt(state);

  assert.match(view.textFallback, /atomicity/i);
  const submitted = await submitPractice(root, {
    attemptId: "scenario-attempt-e2e",
    exerciseUid: exercise.uid,
    exerciseRevision: exercise.revision,
    response,
    artifacts: [],
    hintUsed: false,
  });
  const assessed = await assessPractice(root, {
    attemptId: submitted.attemptId,
    rubricVersion: "rubric-1",
    verdict: "accurate",
    criterionResults: [{ criterionId: "atomicity", result: "met", evidence: response.actions[1].reasoning }],
    nextStep: "Apply the same revision guard to an export operation.",
  });

  const resumedExercise = await getExercise(root, { uid: exercise.uid });
  const replay = await submitPractice(root, {
    attemptId: "scenario-attempt-e2e",
    exerciseUid: exercise.uid,
    exerciseRevision: resumedExercise.revision,
    response,
    artifacts: [],
    hintUsed: false,
  });

  assert.equal(assessed.attemptId, submitted.attemptId);
  assert.equal(replay.attemptId, submitted.attemptId);
  assert.equal(replay.inputHash, submitted.inputHash);
  assert.equal(replay.status, "assessed");
  assert.deepEqual(replay.assessment, assessed.assessment);
  assert.equal(resumedExercise.uid, exercise.uid);
});
