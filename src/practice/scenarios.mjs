function fail(code, message) { throw Object.assign(new Error(`${code}: ${message}`), { code }); }

function validSpec(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) fail("INVALID_SCENARIO", "public scenario spec must be an object");
  if (typeof spec.exerciseUid !== "string" || typeof spec.exerciseRevision !== "string") fail("INVALID_SCENARIO", "exercise UID and revision are required");
  if (!spec.transitions || typeof spec.transitions !== "object" || Array.isArray(spec.transitions)) fail("INVALID_SCENARIO", "transitions must be an object");
  if (spec.actions !== undefined && (!Array.isArray(spec.actions) || spec.actions.some(action => typeof action !== "string"))) fail("INVALID_SCENARIO", "actions must be a list of action names");
}

export function createScenarioState(publicSpec, { seed = 1 } = {}) {
  validSpec(publicSpec);
  if (!Number.isSafeInteger(seed)) fail("INVALID_SCENARIO", "seed must be a safe integer");
  const spec = structuredClone(publicSpec);
  const initial = structuredClone(spec.initialState ?? {});
  const status = typeof initial.status === "string" ? initial.status : "start";
  return {
    exerciseUid: spec.exerciseUid,
    exerciseRevision: spec.exerciseRevision,
    seed,
    randomState: (seed >>> 0) || 0x9e3779b9,
    status,
    state: initial,
    actions: [],
    completed: false,
    publicSpec: spec,
  };
}

export function nextScenarioRandom(state, maximum = 0x7fffffff) {
  if (!Number.isSafeInteger(maximum) || maximum < 1) fail("INVALID_SCENARIO", "maximum must be a positive integer");
  let x = state.randomState >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  const next = { ...state, randomState: x >>> 0 };
  return { state: next, value: (x >>> 0) % maximum };
}

export function applyScenarioAction(state, action) {
  if (!state || !state.publicSpec || !action || typeof action !== "object" || Array.isArray(action)) fail("INVALID_SCENARIO_ACTION", "state and action are required");
  if (state.completed) fail("SCENARIO_COMPLETE", "scenario is already complete");
  if (typeof action.type !== "string" || !action.type) fail("INVALID_SCENARIO_ACTION", "action type is required");
  const allowed = state.publicSpec.actions;
  if (allowed && !allowed.includes(action.type)) fail("INVALID_SCENARIO_ACTION", `action ${action.type} is not allowed`);
  const nextStatus = state.publicSpec.transitions?.[state.status]?.[action.type];
  if (typeof nextStatus !== "string") fail("INVALID_SCENARIO_TRANSITION", `action ${action.type} is not valid from ${state.status}`);
  const publicAction = {
    type: action.type,
    ...(action.choice === undefined ? {} : { choice: structuredClone(action.choice) }),
    ...(action.reasoning === undefined ? {} : { reasoning: String(action.reasoning) }),
  };
  const next = {
    ...state,
    status: nextStatus,
    state: { ...structuredClone(state.state), lastAction: action.type, status: nextStatus },
    actions: [...state.actions.map(item => structuredClone(item)), publicAction],
    completed: state.publicSpec.terminalStates?.includes(nextStatus) ?? nextStatus === "complete",
  };
  return next;
}

export function exportScenarioAttempt(state) {
  if (!state || !Array.isArray(state.actions)) fail("INVALID_SCENARIO_STATE", "scenario state is invalid");
  return {
    exerciseUid: state.exerciseUid,
    exerciseRevision: state.exerciseRevision,
    response: { finalState: structuredClone(state.state), completed: Boolean(state.completed) },
    actions: state.actions.map(action => structuredClone(action)),
    seed: state.seed,
  };
}
