import test from "node:test";
import assert from "node:assert/strict";
import { applyScenarioAction, createScenarioState, exportScenarioAttempt } from "../src/practice/scenarios.mjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const spec = { exerciseUid: "isolation-sim", exerciseRevision: 2, initialState: "start", initialView: "Two requests update the same row.", actions: [{ id: "choose-level", kind: "choose", label: "Select isolation", transitions: ["serializable", "read-committed"] }] };

test("seeded scenario replay preserves deterministic state and learner trace", () => {
  const play = () => exportScenarioAttempt(applyScenarioAction(createScenarioState(spec, { seed: 42 }), { id: "choose-level", nextState: "serializable", reasoning: "The second write must see a consistent order." }));
  assert.deepEqual(play(), play());
});

test("rejects invalid transition and exports reasoning as part of the attempt", () => {
  const state = createScenarioState(spec, { seed: "trial" });
  assert.throws(() => applyScenarioAction(state, { id: "choose-level", nextState: "impossible", reasoning: "because" }), /not an allowed transition/);
  const next = applyScenarioAction(state, { id: "choose-level", nextState: "read-committed", reasoning: "This permits the concurrent read." });
  const attempt = exportScenarioAttempt(next);
  assert.match(attempt.response, /concurrent read/);
  assert.equal(attempt.actions[0].to, "read-committed");
});

test("ships two bounded public simulations with separate private rubrics", async () => {
  for (const uid of ["tool-pipeline-debugging", "transaction-interleaving"]) {
    const publicSpec = JSON.parse(await readFile(join("examples", "exercises", `${uid}.public.json`), "utf8"));
    const privateRubric = JSON.parse(await readFile(join("examples", "exercises", `${uid}.private.json`), "utf8"));
    const state = createScenarioState({ exerciseUid: publicSpec.uid, exerciseRevision: 1, ...publicSpec.publicSpec }, { seed: "acceptance" });
    assert.equal(state.exerciseUid, uid);
    assert.ok(privateRubric.criteria.length >= 3);
    assert.doesNotMatch(JSON.stringify(publicSpec), /criteria|expectedAnswer|solution/i);
    const action = publicSpec.publicSpec.actions[0];
    const attempt = exportScenarioAttempt(applyScenarioAction(state, { id: action.id, nextState: action.transitions[0], reasoning: "I expect this based on the available evidence." }));
    assert.equal(attempt.actions[0].from, publicSpec.publicSpec.initialState);
  }
});
