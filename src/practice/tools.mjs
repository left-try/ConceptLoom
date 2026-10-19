import fs from "node:fs/promises";
import { createExercise as persistExercise, getExercise as readExercise, loadExerciseRecord, readAttempt, practicePaths } from "./model.mjs";
import { resolveContainedPath } from "../storage/paths.mjs";
import { assertRecovery, commitTransaction, hashBytes, recoverTransactions, withWorkspaceLock } from "../storage/transactions.mjs";

const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
};
const inputHash = value => hashBytes(JSON.stringify(canonical(value)));
function fail(code, message) { throw Object.assign(new Error(`${code}: ${message}`), { code }); }

export const createExercise = persistExercise;
export const getExercise = readExercise;

export async function submitPractice(root, input = {}) {
  const request = structuredClone(input);
  const { attemptId, exerciseUid, exerciseRevision } = request;
  if (typeof attemptId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(attemptId)) fail("INVALID_PRACTICE_INPUT", "attemptId must be a stable slug");
  if (typeof exerciseUid !== "string" || typeof exerciseRevision !== "string") fail("INVALID_PRACTICE_INPUT", "exercise UID and revision are required");
  if (request.response === undefined) fail("INVALID_PRACTICE_INPUT", "response is required");
  if (request.artifacts !== undefined && !Array.isArray(request.artifacts)) fail("INVALID_PRACTICE_INPUT", "artifacts must be an array");
  if (request.hintUsed !== undefined && typeof request.hintUsed !== "boolean") fail("INVALID_PRACTICE_INPUT", "hintUsed must be a boolean");
  if (request.confidence !== undefined && (!Number.isInteger(request.confidence) || request.confidence < 0 || request.confidence > 100)) fail("INVALID_PRACTICE_INPUT", "confidence must be an integer from 0 to 100");
  const exercise = await loadExerciseRecord(root, exerciseUid);
  if (!exercise) fail("EXERCISE_NOT_FOUND", `exercise ${exerciseUid} does not exist`);
  if (exercise.revision !== exerciseRevision) fail("EXERCISE_REVISION_CONFLICT", "exercise revision changed after it was shown");
  const hash = inputHash(request), path = practicePaths.attemptPath(attemptId);
  return withWorkspaceLock(root, async () => {
    assertRecovery(await recoverTransactions(root));
    const existing = await readAttempt(root, attemptId);
    if (existing) {
      if (existing.inputHash !== hash) fail("ATTEMPT_CONFLICT", "attemptId was already used with different input");
      return existing;
    }
    const receipt = {
      schemaVersion: 1, attemptId, inputHash: hash, exerciseUid, exerciseRevision,
      lessonUid: exercise.lessonUid, response: request.response, artifacts: request.artifacts ?? [],
      hintUsed: request.hintUsed ?? false, ...(request.confidence === undefined ? {} : { confidence: request.confidence }),
      status: "submitted", submittedAt: new Date().toISOString(),
    };
    await commitTransaction(root, {
      id: `practice-attempt-${attemptId}`,
      checks: [{ path, expectedHash: null }],
      writes: [{ path, value: receipt, encoding: "json" }],
      events: [{ eventId: `practice-submit-${attemptId}`, type: "practice-submitted", attemptId, exerciseUid, exerciseRevision, submittedAt: receipt.submittedAt }],
    });
    return receipt;
  });
}

export async function assessPractice(root, input = {}) {
  const { attemptId, rubricVersion, verdict, criterionResults, nextStep } = input;
  if (typeof attemptId !== "string" || typeof rubricVersion !== "string" || typeof nextStep !== "string" || !nextStep.trim()) fail("INVALID_PRACTICE_INPUT", "attemptId, rubricVersion, and nextStep are required");
  if (!new Set(["accurate", "needs-repair", "knowledge-gap"]).has(verdict)) fail("INVALID_PRACTICE_INPUT", "verdict is invalid");
  if (!Array.isArray(criterionResults)) fail("INVALID_PRACTICE_INPUT", "criterionResults must be an array");
  return withWorkspaceLock(root, async () => {
    assertRecovery(await recoverTransactions(root));
    const attempt = await readAttempt(root, attemptId);
    if (!attempt) fail("ATTEMPT_NOT_FOUND", `attempt ${attemptId} does not exist`);
    const exercise = await loadExerciseRecord(root, attempt.exerciseUid);
    if (!exercise || exercise.revision !== attempt.exerciseRevision) fail("PRACTICE_STATE_INCOMPLETE", "attempt no longer matches an available exercise revision");
    if (exercise.rubricVersion !== rubricVersion) fail("RUBRIC_VERSION_CONFLICT", "rubric version does not match the exercise");
    const proposed = { rubricVersion, verdict, criterionResults: structuredClone(criterionResults), nextStep };
    const privateItems = exercise.privateCriteria.criteria ?? exercise.privateCriteria.rubric ?? [];
    const allowedCriteria = new Set(privateItems.map(item => typeof item === "string" ? item : item?.id).filter(Boolean));
    for (const result of proposed.criterionResults) {
      if (!result || typeof result.criterionId !== "string" || typeof result.result !== "string") fail("INVALID_PRACTICE_INPUT", "criterion results require criterionId and result");
      if (allowedCriteria.size && !allowedCriteria.has(result.criterionId)) fail("INVALID_ASSESSMENT_CRITERION", `unknown criterion ${result.criterionId}`);
      if (typeof result.evidence !== "string" || !JSON.stringify(attempt.response).includes(result.evidence)) fail("INVALID_ASSESSMENT_EVIDENCE", "criterion evidence must quote the submitted response");
    }
    const hash = inputHash(proposed);
    if (attempt.assessment) {
      if (attempt.assessment.inputHash !== hash) fail("ASSESSMENT_CONFLICT", "attempt already has a different assessment");
      return attempt;
    }
    const path = practicePaths.attemptPath(attemptId);
    const bytes = await fs.readFile(await resolveContainedPath(root, path));
    const assessment = { ...proposed, inputHash: hash };
    const receipt = { ...attempt, ...proposed, rubricVersion, criterionResults: proposed.criterionResults, status: "assessed", assessment, assessedAt: new Date().toISOString() };
    await commitTransaction(root, {
      id: `practice-assessment-${attemptId}-${hash.slice(0, 16)}`,
      checks: [{ path, expectedHash: hashBytes(bytes) }],
      writes: [{ path, value: receipt, encoding: "json" }],
      events: [{ eventId: `practice-assessment-${attemptId}`, type: "practice-assessed", attemptId, exerciseUid: attempt.exerciseUid, assessedAt: receipt.assessedAt }],
    });
    return receipt;
  });
}

const schema = (required, properties) => ({ type: "object", required, properties });
const definitions = [
  {
    name: "loom_create_exercise", description: "Create a versioned practice exercise while keeping grading criteria private.",
    inputSchema: schema(["uid", "lessonUid", "kind", "publicSpec", "privateCriteria"], {
      uid: { type: "string" }, lessonUid: { type: "string" }, kind: { enum: ["scenario", "simulation", "coding"] },
      publicSpec: { type: "object" }, privateCriteria: { type: "object", description: "Stored privately; never returned by public reads or exports." },
    }),
  },
  {
    name: "loom_get_exercise", description: "Read the public specification of a practice exercise.",
    inputSchema: schema(["uid"], { uid: { type: "string" } }),
  },
  {
    name: "loom_submit_practice", description: "Persist one learner attempt against the exact exercise revision.",
    inputSchema: schema(["attemptId", "exerciseUid", "exerciseRevision", "response"], {
      attemptId: { type: "string" }, exerciseUid: { type: "string" }, exerciseRevision: { type: "string" },
      response: {}, artifacts: { type: "array" }, hintUsed: { type: "boolean" }, confidence: { type: "integer", minimum: 0, maximum: 100 },
    }),
  },
  {
    name: "loom_assess_practice", description: "Attach a rubric-based assessment to a previously saved attempt.",
    inputSchema: schema(["attemptId", "rubricVersion", "verdict", "criterionResults", "nextStep"], {
      attemptId: { type: "string" }, rubricVersion: { type: "string" }, verdict: { enum: ["accurate", "needs-repair", "knowledge-gap"] },
      criterionResults: { type: "array", items: { type: "object" } }, nextStep: { type: "string" },
    }),
  },
];

export function practiceTools(root) {
  const handlers = {
    loom_create_exercise: args => createExercise(root, args),
    loom_get_exercise: args => getExercise(root, args),
    loom_submit_practice: args => submitPractice(root, args),
    loom_assess_practice: args => assessPractice(root, args),
  };
  return definitions.map(definition => ({ definition, invoke: handlers[definition.name] }));
}
