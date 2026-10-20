import { createHash } from "node:crypto";

const allowedKinds = new Set(["choose", "observe", "explain", "configure"]);
function seedNumber(seed) { return createHash("sha256").update(String(seed)).digest().readUInt32BE(0); }

export function createScenarioState(publicSpec, { seed = "conceptloom" } = {}) {
  if (!publicSpec || typeof publicSpec !== "object" || !Array.isArray(publicSpec.actions) || publicSpec.actions.length === 0) throw new Error("scenario requires public actions");
  const actionIds = new Set();
  for (const action of publicSpec.actions) {
    if (!action || typeof action.id !== "string" || actionIds.has(action.id) || !allowedKinds.has(action.kind) || typeof action.label !== "string") throw new Error("scenario action is malformed or duplicated");
    actionIds.add(action.id);
    if (!Array.isArray(action.transitions)) throw new Error(`action '${action.id}' must declare allowed transitions`);
  }
  return { exerciseUid: publicSpec.exerciseUid, exerciseRevision: publicSpec.exerciseRevision, seed: String(seed), state: publicSpec.initialState ?? "start", visible: publicSpec.initialView ?? null, trace: [], randomState: seedNumber(seed), actions: structuredClone(publicSpec.actions) };
}

export function applyScenarioAction(state, action) {
  const allowed = state?.actions?.find((item) => item.id === action?.id);
  if (!allowed || !allowed.transitions.includes(action.nextState)) throw new Error("scenario action is not an allowed transition");
  if (typeof action.reasoning !== "string" || !action.reasoning.trim()) throw new Error("scenario decision must include the learner's reasoning");
  const next = { ...state, state: action.nextState, visible: action.visible ?? state.visible, trace: [...state.trace, { actionId: action.id, from: state.state, to: action.nextState, reasoning: action.reasoning.trim(), visible: action.visible ?? null }] };
  return next;
}

export function exportScenarioAttempt(state) {
  if (!state || !Array.isArray(state.trace)) throw new Error("scenario state is invalid");
  return { exerciseUid: state.exerciseUid, exerciseRevision: state.exerciseRevision, response: state.trace.map((item) => item.reasoning).join("\n"), actions: structuredClone(state.trace), seed: state.seed, finalState: state.state };
}
