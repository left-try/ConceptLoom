import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolveContainedPath } from "../storage/paths.mjs";
import { assertRecovery, commitTransaction, recoverTransactions, withWorkspaceLock } from "../storage/transactions.mjs";

const base = ".concept-loom/practice";
const kinds = new Set(["scenario", "simulation", "coding"]);
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
};
const hash = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(canonical(value))).digest("hex");
function fail(code, message) { throw Object.assign(new Error(`${code}: ${message}`), { code }); }
function safeId(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)) fail("INVALID_PRACTICE_INPUT", `${label} must be a stable slug`);
  return value;
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_PRACTICE_INPUT", `${label} must be an object`);
  return structuredClone(value);
}
async function readJson(root, path) {
  try { return JSON.parse(await fs.readFile(await resolveContainedPath(root, path), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
const exercisePath = uid => `${base}/exercises/${uid}.json`;
const privatePath = uid => `${base}/private/${uid}.json`;
const attemptPath = id => `${base}/attempts/${id}.json`;

export function publicExercise(record) {
  if (!record) return null;
  const { privateCriteria: _private, rubricVersion: _rubric, ...visible } = record;
  return structuredClone(visible);
}

export async function loadExerciseRecord(root, uid) {
  const id = safeId(uid, "uid");
  const record = await readJson(root, exercisePath(id));
  if (!record) return null;
  const privateRecord = await readJson(root, privatePath(id));
  if (!privateRecord || privateRecord.exerciseRevision !== record.revision) fail("PRACTICE_STATE_INCOMPLETE", "private criteria do not match the public exercise revision");
  return { ...record, privateCriteria: privateRecord.privateCriteria, rubricVersion: privateRecord.rubricVersion };
}

export async function createExercise(root, { uid, lessonUid, kind, publicSpec: spec, privateCriteria: criteria } = {}) {
  const id = safeId(uid, "uid"), lesson = safeId(lessonUid, "lessonUid");
  if (!kinds.has(kind)) fail("INVALID_PRACTICE_INPUT", "kind must be scenario, simulation, or coding");
  const publicSpec = object(spec, "publicSpec"), privateCriteria = object(criteria, "privateCriteria");
  const revision = hash({ schemaVersion: 1, uid: id, lessonUid: lesson, kind, publicSpec });
  const record = { schemaVersion: 1, uid: id, lessonUid: lesson, kind, revision, publicSpec, createdAt: new Date().toISOString() };
  const privateRecord = {
    schemaVersion: 1,
    uid: id,
    exerciseRevision: revision,
    rubricVersion: typeof privateCriteria.rubricVersion === "string" ? privateCriteria.rubricVersion : "rubric-1",
    privateCriteria,
  };
  return withWorkspaceLock(root, async () => {
    assertRecovery(await recoverTransactions(root));
    if (await readJson(root, exercisePath(id))) fail("EXERCISE_ALREADY_EXISTS", `exercise ${id} already exists`);
    await commitTransaction(root, {
      id: `practice-exercise-${id}`,
      checks: [{ path: exercisePath(id), expectedHash: null }, { path: privatePath(id), expectedHash: null }],
      writes: [
        { path: exercisePath(id), value: record, encoding: "json" },
        { path: privatePath(id), value: privateRecord, encoding: "json" },
      ],
      events: [{ eventId: `exercise-${id}`, type: "practice-exercise-created", lessonUid: lesson, exerciseUid: id, revision }],
    });
    return publicExercise(record);
  });
}

export async function getExercise(root, { uid } = {}) {
  const record = await loadExerciseRecord(root, uid);
  return publicExercise(record);
}

export async function readAttempt(root, attemptId) {
  return readJson(root, attemptPath(safeId(attemptId, "attemptId")));
}

export const practicePaths = { exercisePath, privatePath, attemptPath, hash };
