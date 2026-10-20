import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluateCheckpoint, consumeCheckpoint } from "./checkpoints.mjs";
import { applyCheckpointAssessment, loadLearningState } from "./progress.mjs";
import { commitTransaction } from "./storage/transactions.mjs";

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function attemptName(value) {
  const id = value ?? randomUUID();
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("attemptId contains unsupported characters");
  return id;
}

async function readReceipt(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

export async function assessAndPersist(root, input) {
  const attemptId = attemptName(input.attemptId);
  const inputHash = digest({ ...input, attemptId });
  const receiptPath = join(root, ".concept-loom", "assessments", "attempts", `${attemptId}.json`);
  const previousReceipt = await readReceipt(receiptPath);
  if (previousReceipt) {
    if (previousReceipt.inputHash !== inputHash) {
      const error = new Error("attemptId was already used with different input"); error.code = "ATTEMPT_CONFLICT"; throw error;
    }
    return { assessment: previousReceipt.assessment, learningState: previousReceipt.learningState, attemptId, replayed: true };
  }

  const assessment = evaluateCheckpoint(input);
  const { state: previous } = await loadLearningState(root, { sessionId: input.sessionId });
  if (input.expectedRevision !== undefined && input.expectedRevision !== previous.revision) {
    const error = new Error("learning state revision changed before assessment"); error.code = "REVISION_CONFLICT"; throw error;
  }
  const learningState = applyCheckpointAssessment(previous, input, assessment);
  const receipt = { attemptId, inputHash, assessment, learningState, committedAt: new Date().toISOString() };
  await commitTransaction(root, {
    id: `assessment-${attemptId}`,
    checks: [{ path: `.concept-loom/sessions/${input.sessionId}.json`, expectedRevision: previous.revision ?? null }],
    writes: [
      { path: `.concept-loom/sessions/${input.sessionId}.json`, value: learningState, encoding: "json" },
      { path: `.concept-loom/assessments/attempts/${attemptId}.json`, value: receipt, encoding: "json" },
    ],
  });
  const committed = await readReceipt(receiptPath);
  if (committed?.inputHash !== inputHash) {
    const error = new Error("attemptId was concurrently used with different input"); error.code = "ATTEMPT_CONFLICT"; throw error;
  }
  consumeCheckpoint(input.token);
  return { assessment: committed.assessment, learningState: committed.learningState, attemptId, replayed: false };
}
