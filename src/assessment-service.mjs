import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { consumeCheckpoint, evaluateCheckpoint, publicCheckpointAssessment } from "./checkpoints.mjs";
import { checkpointAssessmentPatch, loadLearningState, publicLearningState } from "./progress.mjs";
import { resolveContainedPath } from "./storage/paths.mjs";
import { assertRecovery, commitTransaction, hashBytes, recoverTransactions, withWorkspaceLock } from "./storage/transactions.mjs";
import { assessmentCapturePointer, captureAssessment } from "./evaluation/capture.mjs";

const tokenQueues = new Map();

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
function safeId(value, label) {
  const id = requiredText(value, label);
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) throw new Error(`${label} may contain only letters, numbers, underscores, and hyphens (maximum 64 characters)`);
  return id;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
async function withTokenLock(token, operation) {
  const previous = tokenQueues.get(token) ?? Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const tail = previous.then(() => gate);
  tokenQueues.set(token, tail);
  await previous;
  try { return await operation(); }
  finally {
    release();
    if (tokenQueues.get(token) === tail) tokenQueues.delete(token);
  }
}
async function readReceipt(root, path) {
  try { return JSON.parse(await readFile(await resolveContainedPath(root, path), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export async function assessAndPersist(root, input, { capture = true, host = "other" } = {}) {
  // Copy before awaiting so caller mutations cannot alter a queued request.
  const request = JSON.parse(JSON.stringify(input));
  const token = requiredText(request.token, "token");
  const sessionId = safeId(request.sessionId, "sessionId");
  requiredText(request.nextStep, "nextStep");
  if (request.hintUsed !== undefined && typeof request.hintUsed !== "boolean") throw new Error("hintUsed must be a boolean");
  if (Object.hasOwn(request, "expectedRevision") && request.expectedRevision !== null
    && (!Number.isInteger(request.expectedRevision) || request.expectedRevision < 0)) throw new Error("expectedRevision must be a non-negative integer or null");
  const attemptId = request.attemptId === undefined ? randomUUID() : safeId(request.attemptId, "attemptId");
  delete request.attemptId;
  const inputHash = hashBytes(JSON.stringify(canonical(request)));
  const receiptPath = `.concept-loom/assessments/attempts/${attemptId}.json`;
  const tokenPath = `.concept-loom/assessments/tokens/${hashBytes(token)}.json`;
  return withTokenLock(token, () => withWorkspaceLock(root, async () => {
    assertRecovery(await recoverTransactions(root));
    const existing = await readReceipt(root, receiptPath);
    if (existing) {
      if (existing.attemptId !== attemptId || existing.inputHash !== inputHash) {
        throw Object.assign(new Error("ATTEMPT_CONFLICT: attemptId was already used with different input"), { code: "ATTEMPT_CONFLICT" });
      }
      consumeCheckpoint(token);
      return { assessment: publicCheckpointAssessment(existing.assessment), learningState: publicLearningState(existing.learningState), attemptId,
        ...(capture ? { capture: await captureAssessment(root, existing) } : {}) };
    }

    // A different tool may have recovered an interrupted commit while this
    // process still holds its card. The durable claim keeps it single-use.
    if (await readReceipt(root, tokenPath)) {
      consumeCheckpoint(token);
      throw new Error("checkpoint token is unknown or expired");
    }

    const assessment = evaluateCheckpoint(request);
    // Load migrates old schemas with F1's backups; derive this update and its
    // hash guard from the same raw bytes rather than two separate state reads.
    await loadLearningState(root, { sessionId });
    const statePath = `.concept-loom/sessions/${sessionId}.json`;
    const bytes = await readFile(await resolveContainedPath(root, statePath));
    const previous = publicLearningState(JSON.parse(bytes));
    if (Object.hasOwn(request, "expectedRevision") && previous.revision !== request.expectedRevision) {
      throw Object.assign(new Error("REVISION_CONFLICT: learning state changed"), { code: "REVISION_CONFLICT" });
    }
    const assessedAt = new Date().toISOString();
    const patch = checkpointAssessmentPatch(previous, { ...request, attemptId }, assessment, assessedAt);
    const learningState = { ...previous, ...patch, schemaVersion: 3, updatedAt: assessedAt, revision: previous.revision + 1 };
    const receipt = JSON.parse(JSON.stringify({ schemaVersion: 1, attemptId, inputHash, input: request, assessment, learningState, assessedAt,
      capture: assessmentCapturePointer(attemptId, host) }));
    await commitTransaction(root, {
      id: `assessment-${attemptId}`,
      checks: [{ path: statePath, expectedHash: hashBytes(bytes) }, { path: receiptPath, expectedHash: null }, { path: tokenPath, expectedHash: null }],
      writes: [
        { path: statePath, value: receipt.learningState, encoding: "json" },
        { path: receiptPath, value: receipt, encoding: "json" },
        { path: tokenPath, value: { schemaVersion: 1, token, attemptId }, encoding: "json" },
      ],
      events: [{ eventId: attemptId, type: "checkpoint-assessed", sessionId, token, assessedAt }],
    });
    consumeCheckpoint(token);
    return { assessment: publicCheckpointAssessment(receipt.assessment), learningState: receipt.learningState, attemptId,
      ...(capture ? { capture: await captureAssessment(root, receipt) } : {}) };
  }));
}
