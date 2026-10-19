import fs from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveContainedPath } from "../storage/paths.mjs";
import { assertRecovery, commitTransaction, hashBytes, recoverTransactions, withWorkspaceLock } from "../storage/transactions.mjs";
import { loadExerciseRecord, practicePaths, readAttempt } from "./model.mjs";
import { submitPractice } from "./tools.mjs";
import { validateExecutor } from "./executors/interface.mjs";

const MAX_OUTPUT = 65_536;
function fail(code, message) { throw Object.assign(new Error(`${code}: ${message}`), { code }); }
function safeFiles(files) {
  if (!files || typeof files !== "object" || Array.isArray(files) || !Object.keys(files).length) fail("INVALID_CODING_INPUT", "files must be a non-empty object");
  const result = {};
  for (const [name, value] of Object.entries(files)) {
    if (!name || name.includes("\0") || name.includes(":") || name.startsWith("/") || name.startsWith("\\") || name.split(/[\\/]/).includes("..")) fail("INVALID_LEARNER_PATH", `learner path is not contained: ${name}`);
    if (typeof value !== "string") fail("INVALID_CODING_INPUT", `file ${name} must contain text`);
    result[name] = value;
  }
  return result;
}
function cap(text, limit) {
  const bytes = Buffer.from(String(text ?? ""), "utf8");
  return { text: bytes.subarray(0, limit).toString("utf8"), truncated: bytes.length > limit };
}
async function storeExecution(root, attemptId, outcome) {
  return withWorkspaceLock(root, async () => {
    assertRecovery(await recoverTransactions(root));
    const path = practicePaths.attemptPath(attemptId);
    const absolute = await resolveContainedPath(root, path);
    const bytes = await fs.readFile(absolute), previous = JSON.parse(bytes);
    const status = outcome.status === "unavailable" ? "execution-unverified" : outcome.status;
    const receipt = { ...previous, status, execution: outcome, executionAt: new Date().toISOString() };
    await commitTransaction(root, {
      id: `practice-execution-${attemptId}-${randomUUID().replaceAll("-", "")}`,
      checks: [{ path, expectedHash: hashBytes(bytes) }],
      writes: [{ path, value: receipt, encoding: "json" }],
      events: [{ eventId: `practice-execution-${attemptId}`, type: "practice-execution-recorded", attemptId, status, recordedAt: receipt.executionAt }],
    });
    return receipt;
  });
}

export async function runCodingAttempt(root, input = {}) {
  const { attemptId, exerciseUid, exerciseRevision } = input;
  const files = safeFiles(input.files);
  const exercise = await loadExerciseRecord(root, exerciseUid);
  if (!exercise) fail("EXERCISE_NOT_FOUND", `exercise ${exerciseUid} does not exist`);
  if (exercise.kind !== "coding") fail("EXERCISE_KIND_MISMATCH", "coding executor requires a coding exercise");
  if (exercise.revision !== exerciseRevision) fail("EXERCISE_REVISION_CONFLICT", "exercise revision changed after it was shown");
  const runner = exercise.privateCriteria.runner;
  if (!runner || !Array.isArray(runner.command) || typeof runner.imageDigest !== "string") fail("TRUSTED_RUNNER_NOT_CONFIGURED", "coding exercise has no trusted runner configuration");
  const executor = validateExecutor(input.executorConfig?.backend);
  const submission = await submitPractice(root, {
    attemptId, exerciseUid, exerciseRevision,
    response: { files }, artifacts: [], hintUsed: Boolean(input.hintUsed),
  });
  if (submission.execution) return { ...submission.execution, status: submission.status === "execution-unverified" ? "unavailable" : submission.status, attemptId };

  const relativeStage = `.concept-loom/practice/staging/${attemptId}`;
  const stagePath = await resolveContainedPath(root, relativeStage, { create: true });
  await fs.mkdir(stagePath, { recursive: true });
  let result;
  try {
    for (const [name, content] of Object.entries(files)) {
      const destination = await resolveContainedPath(root, `${relativeStage}/${name}`, { create: true });
      await fs.mkdir(dirname(destination), { recursive: true });
      await fs.writeFile(destination, content, { encoding: "utf8", flag: "wx" });
    }
    const available = await executor.available();
    if (!available) {
      result = { status: "unavailable", stdout: "", stderr: "", checks: [], durationMs: 0, diagnostics: ["Executor is unavailable; submitted code was not run."], stdoutTruncated: false, stderrTruncated: false };
    } else {
      const raw = await executor.run({ stagingPath: stagePath, imageDigest: runner.imageDigest, command: runner.command, limits: runner.limits });
      const outputLimit = Math.min(MAX_OUTPUT, runner.limits?.outputBytes ?? MAX_OUTPUT);
      const stdout = cap(raw.stdout, outputLimit), stderr = cap(raw.stderr, outputLimit);
      const status = ["completed", "failed", "timeout"].includes(raw.status) ? raw.status : raw.exitCode === 0 ? "completed" : "failed";
      const expected = exercise.privateCriteria.expectedStdout;
      const checks = typeof expected === "string" && status === "completed" ? [{ id: "expected-stdout", passed: stdout.text.trim() === expected.trim() }] : [];
      const diagnostics = [
        ...(stdout.truncated ? ["stdout truncated at configured output limit"] : []),
        ...(stderr.truncated ? ["stderr truncated at configured output limit"] : []),
      ];
      result = { status, stdout: stdout.text, stderr: stderr.text, checks, durationMs: Number.isFinite(raw.durationMs) ? raw.durationMs : 0, diagnostics, stdoutTruncated: stdout.truncated || Boolean(raw.stdoutTruncated), stderrTruncated: stderr.truncated || Boolean(raw.stderrTruncated) };
    }
  } catch (error) {
    result = { status: "failed", stdout: "", stderr: "", checks: [], durationMs: 0, diagnostics: [error instanceof Error ? error.message : String(error)], stdoutTruncated: false, stderrTruncated: false };
  } finally {
    await fs.rm(stagePath, { recursive: true, force: true });
  }
  await storeExecution(root, attemptId, result);
  return { ...result, attemptId };
}
