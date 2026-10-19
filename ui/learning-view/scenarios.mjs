window.ConceptLoomScenarios = (() => {
  function createScenarioState(publicSpec, seed = 1) {
    const initial = structuredClone(publicSpec.initialState ?? {});
    const status = initial.status ?? "start";
    return { exerciseUid: publicSpec.exerciseUid, exerciseRevision: publicSpec.exerciseRevision, seed, status, state: initial, actions: [], completed: false, publicSpec: structuredClone(publicSpec) };
  }
  function applyScenarioAction(state, action) {
    if (state.completed) throw new Error("Scenario is complete");
    if (state.publicSpec.actions && !state.publicSpec.actions.includes(action.type)) throw new Error("Action is not allowed");
    const nextStatus = state.publicSpec.transitions?.[state.status]?.[action.type];
    if (!nextStatus) throw new Error("Invalid scenario transition");
    return { ...state, status: nextStatus, state: { ...state.state, status: nextStatus, lastAction: action.type }, actions: [...state.actions, { type: action.type, reasoning: String(action.reasoning ?? "") }], completed: (state.publicSpec.terminalStates ?? ["complete"]).includes(nextStatus) };
  }
  function exportScenarioAttempt(state) {
    return { exerciseUid: state.exerciseUid, exerciseRevision: state.exerciseRevision, response: { finalState: state.state, completed: state.completed }, actions: state.actions, seed: state.seed };
  }
  return { createScenarioState, applyScenarioAction, exportScenarioAttempt };
})();
