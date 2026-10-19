import test from "node:test";
import assert from "node:assert/strict";
import { createScenarioState, applyScenarioAction, exportScenarioAttempt } from "../src/practice/scenarios.mjs";

const publicSpec = {
  exerciseUid: "transaction-race",
  exerciseRevision: "rev-1",
  initialState: { revision: 3, writes: [] },
  actions: ["read", "compare-and-swap", "commit"],
  transitions: {
    start: { read: "read" },
    read: { "compare-and-swap": "checked" },
    checked: { commit: "complete" },
  },
};

test("a fixed seed recreates the same scenario state", () => {
  const first = createScenarioState(publicSpec, { seed: 7123 });
  const second = createScenarioState(publicSpec, { seed: 7123 });

  assert.deepEqual(first, second);
});

test("an invalid scenario transition is rejected without changing state", () => {
  const state = createScenarioState(publicSpec, { seed: 7123 });
  const before = structuredClone(state);

  assert.throws(() => applyScenarioAction(state, { type: "commit", reasoning: "Skip the revision check." }));
  assert.deepEqual(state, before);
});

test("attempt export preserves action order and reasoning even when final choices match", () => {
  const left = createScenarioState(publicSpec, { seed: 19 });
  const right = createScenarioState(publicSpec, { seed: 19 });
  const leftDone = applyScenarioAction(
    applyScenarioAction(left, { type: "read", reasoning: "Read current version first." }),
    { type: "compare-and-swap", reasoning: "Reject stale writers." },
  );
  const rightDone = applyScenarioAction(
    applyScenarioAction(right, { type: "read", reasoning: "Assume no concurrent writer." }),
    { type: "compare-and-swap", reasoning: "Only check once at startup." },
  );

  const leftAttempt = exportScenarioAttempt(leftDone);
  const rightAttempt = exportScenarioAttempt(rightDone);

  assert.equal(leftAttempt.exerciseUid, publicSpec.exerciseUid);
  assert.equal(leftAttempt.exerciseRevision, publicSpec.exerciseRevision);
  assert.equal(leftAttempt.seed, 19);
  assert.notDeepEqual(leftAttempt.actions, rightAttempt.actions);
});

test("scenario export contains no private answer or grading rationale", () => {
  const state = applyScenarioAction(
    createScenarioState(publicSpec, { seed: 20 }),
    { type: "read", reasoning: "Inspect the write trace." },
  );

  const attempt = exportScenarioAttempt(state);

  assert.doesNotMatch(JSON.stringify(attempt), /private-answer|hidden-rubric|solutionKey/);
  assert.ok(attempt.actions.some(action => action.reasoning === "Inspect the write trace."));
});
