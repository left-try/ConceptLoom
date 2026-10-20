import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { commitTransaction } from "../storage/transactions.mjs";
import { captureEvent } from "../evaluation/capture.mjs";
import { applyCheckpointAssessment, loadLearningState } from "../progress.mjs";

const idPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const pathFor = (uid, file) => `.concept-loom/practice/${uid}/${file}.json`;
const hash = (value) => `sha256:${createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex")}`;
async function read(root, path) { try { return JSON.parse(await readFile(join(root, path), "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }

export async function createExercise(root, { uid, lessonUid, courseUid, sessionId, evidenceConcept, kind, publicSpec, privateCriteria }) {
  if (!idPattern.test(uid ?? "") || !idPattern.test(lessonUid ?? "")) throw new Error("exercise and lesson UIDs must be safe identifiers");
  if (!new Set(["scenario", "simulation", "coding"]).has(kind)) throw new Error("kind must be scenario, simulation, or coding");
  if (!publicSpec || typeof publicSpec !== "object" || Array.isArray(publicSpec)) throw new Error("publicSpec must be an object");
  if (!Array.isArray(privateCriteria) || !privateCriteria.length || privateCriteria.some((item) => typeof item !== "string" || !item.trim())) throw new Error("privateCriteria must be a non-empty list of strings");
  const path = pathFor(uid, "public");
  if (await read(root, path)) throw new Error(`exercise '${uid}' already exists`);
  const exercise = { schemaVersion: 1, uid, courseUid, lessonUid, sessionId, evidenceConcept, kind, revision: 1, publicSpec: structuredClone(publicSpec), createdAt: new Date().toISOString() };
  await commitTransaction(root, { id: `exercise-${uid}-${randomUUID()}`, checks: [{ path, expectedRevision: null }], writes: [
    { path, value: exercise, encoding: "json" },
    { path: pathFor(uid, "private"), value: { exerciseUid: uid, criteria: privateCriteria }, encoding: "json" },
  ] });
  return exercise;
}

export async function getExercise(root, { uid }) {
  const exercise = await read(root, pathFor(uid, "public"));
  if (!exercise) throw new Error(`exercise '${uid}' was not found`);
  return exercise;
}

export async function submitPractice(root, { attemptId = randomUUID(), exerciseUid, exerciseRevision, response, artifacts = [], hintUsed = false, confidence }) {
  if (!idPattern.test(attemptId) || typeof response !== "string" || !response.trim()) throw new Error("attemptId and non-empty response are required");
  const exercise = await getExercise(root, { uid: exerciseUid });
  if (exercise.revision !== exerciseRevision) { const error = new Error("exercise revision changed"); error.code = "EXERCISE_REVISION_CONFLICT"; throw error; }
  if (confidence !== undefined && (!Number.isInteger(confidence) || confidence < 0 || confidence > 100)) throw new Error("confidence must be from 0 to 100");
  const inputHash = hash({ exerciseUid, exerciseRevision, response, artifacts, hintUsed, confidence });
  const path = pathFor(attemptId, "attempt"); const previous = await read(root, path);
  if (previous) {
    if (previous.inputHash !== inputHash) { const error = new Error("attemptId was reused with different response data"); error.code = "ATTEMPT_CONFLICT"; throw error; }
    return previous;
  }
  const receipt = { schemaVersion: 1, attemptId, courseUid: exercise.courseUid, lessonUid: exercise.lessonUid, sessionId: exercise.sessionId, evidenceConcept: exercise.evidenceConcept, kind: exercise.kind, exerciseUid, exerciseRevision, status: "submitted", response, responseHash: hash(response), artifacts, hintUsed: hintUsed === true, confidence, inputHash, submittedAt: new Date().toISOString(), revision: 1 };
  await commitTransaction(root, { id: `practice-submit-${attemptId}`, checks: [{ path, expectedRevision: null }], writes: [{ path, value: receipt, encoding: "json" }] });
  return read(root, path);
}

export async function assessPractice(root, { attemptId, rubricVersion, verdict, criterionResults, feedback, nextStep }) {
  if (!idPattern.test(attemptId ?? "") || typeof rubricVersion !== "string" || !rubricVersion.trim()) throw new Error("attemptId and rubricVersion are required");
  const path = pathFor(attemptId, "attempt"); const attempt = await read(root, path);
  if (!attempt) throw new Error(`attempt '${attemptId}' was not found`);
  const assessmentHash = hash({ rubricVersion, verdict, criterionResults, feedback, nextStep });
  if (attempt.status === "assessed") {
    if (attempt.assessmentHash !== assessmentHash) { const error = new Error("attempt was already assessed with different feedback"); error.code = "ATTEMPT_CONFLICT"; throw error; }
    let capture = { recorded: false, diagnostics: [] };
    try { capture = await captureEvent(root, { eventId: `attempt-${attemptId}`, kind: "practice-assessed", courseUid: attempt.courseUid, lessonUid: attempt.lessonUid, attemptId, outcome: attempt.verdict }); }
    catch (error) { capture = { recorded: false, diagnostics: [`capture unavailable: ${error.message}`] }; }
    return { ...attempt, captureDiagnostics: capture.diagnostics };
  }
  if (attempt.status !== "submitted") throw new Error("attempt is not ready for assessment");
  if (!new Set(["accurate", "partial", "needs-repair", "knowledge-gap"]).has(verdict)) throw new Error("unsupported practice verdict");
  if (!Array.isArray(criterionResults) || !criterionResults.length || criterionResults.some((item) => !item || typeof item.criterion !== "string" || !new Set(["met", "partial", "missed"]).has(item.result))) throw new Error("criterionResults must contain criterion-level outcomes");
  if (typeof feedback !== "string" || !feedback.trim() || typeof nextStep !== "string" || !nextStep.trim()) throw new Error("response-specific feedback and nextStep are required");
  const rubric = await read(root, pathFor(attempt.exerciseUid, "private"));
  const known = new Set(rubric.criteria);
  for (const item of criterionResults) if (!known.has(item.criterion)) throw new Error("assessment references a criterion outside the private exercise rubric");
  const assessedAt = new Date().toISOString();
  const updated = { ...attempt, status: "assessed", verdict, criterionResults: structuredClone(criterionResults), feedback: feedback.trim(), nextStep: nextStep.trim(), rubricVersion, assessmentMethod: "host-rubric", assessedAt, assessmentHash, revision: attempt.revision + 1, unaided: attempt.hintUsed !== true };
  const evidencePath = `.concept-loom/assessments/attempts/${attemptId}.json`;
  const evidenceReceipt = { schemaVersion: 1, attemptId, courseUid: attempt.courseUid, lessonUid: attempt.lessonUid, exerciseUid: attempt.exerciseUid, exerciseRevision: attempt.exerciseRevision, outcome: verdict, assessedAt, responseHash: attempt.responseHash, hintUsed: attempt.hintUsed, rubricVersion };
  const checks = [{ path, expectedRevision: attempt.revision }, { path: evidencePath, expectedRevision: null }];
  const writes = [
    { path, value: updated, encoding: "json" },
    { path: evidencePath, value: evidenceReceipt, encoding: "json" },
  ];
  if (attempt.sessionId) {
    const { state } = await loadLearningState(root, { sessionId: attempt.sessionId });
    const outcome = verdict === "accurate" ? "accurate" : verdict === "knowledge-gap" ? "knowledge-gap" : "partial";
    const format = attempt.kind === "coding" ? "debugging" : attempt.kind === "simulation" ? "prediction" : "transfer";
    const learningState = applyCheckpointAssessment(state, {
      evidenceConcept: attempt.evidenceConcept ?? attempt.lessonUid,
      securedConnection: attempt.evidenceConcept,
      currentStep: attempt.lessonUid,
      nextStep: nextStep.trim(),
      hintUsed: attempt.hintUsed === true,
    }, { outcome, format, response: attempt.response, confidence: attempt.confidence });
    const sessionPath = `.concept-loom/sessions/${attempt.sessionId}.json`;
    checks.push({ path: sessionPath, expectedRevision: state.revision ?? null });
    writes.push({ path: sessionPath, value: learningState, encoding: "json" });
    evidenceReceipt.learningStateRevision = learningState.revision;
    evidenceReceipt.evidenceConcept = attempt.evidenceConcept ?? attempt.lessonUid;
  }
  await commitTransaction(root, { id: `practice-assess-${attemptId}`, checks, writes });
  let capture = { recorded: false, diagnostics: [] };
  try {
    capture = await captureEvent(root, { eventId: `attempt-${attemptId}`, kind: "practice-assessed", courseUid: updated.courseUid, lessonUid: updated.lessonUid, attemptId, outcome: updated.verdict });
  } catch (error) { capture = { recorded: false, diagnostics: [`capture unavailable: ${error.message}`] }; }
  return { ...updated, captureDiagnostics: capture.diagnostics };
}
