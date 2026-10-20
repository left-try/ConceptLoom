import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { commitTransaction } from "../storage/transactions.mjs";

const EVENT_PATH = ".concept-loom/evaluation/events.jsonl";
const ALLOWED = new Set(["schemaVersion", "eventId", "kind", "recordedAt", "courseUid", "lessonUid", "attemptId", "outcome", "format", "promptDigest", "sourceRevisions"]);
async function readEvents(root) {
  try { return await readFile(join(root, EVENT_PATH), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}
function hash(value) { return createHash("sha256").update(value).digest("hex"); }

export function validateContract(name, value) {
  const errors = [];
  if (name === "capture-event") {
    for (const key of ["schemaVersion", "eventId", "kind", "recordedAt"]) if (value?.[key] === undefined) errors.push(`${key} is required`);
    if (value?.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
    if (!new Set(["practice-assessed", "state-restored", "lesson-published", "lesson-completed"]).has(value?.kind)) errors.push("kind is unsupported");
    for (const key of Object.keys(value ?? {})) if (!ALLOWED.has(key)) errors.push(`${key} is not allowed`);
  } else if (name === "eval-result") {
    for (const key of ["caseId", "status", "dimensions"]) if (value?.[key] === undefined) errors.push(`${key} is required`);
    if (!new Set(["pass", "fail", "error", "skipped"]).has(value?.status)) errors.push("status is unsupported");
    if (!value?.dimensions || typeof value.dimensions !== "object" || Array.isArray(value.dimensions)) errors.push("dimensions must be an object");
  } else errors.push(`unknown contract '${name}'`);
  return { valid: errors.length === 0, errors };
}

export async function captureEvent(root, event) {
  const publicEvent = Object.fromEntries(Object.entries(event ?? {}).filter(([key]) => ALLOWED.has(key)));
  publicEvent.schemaVersion = 1;
  publicEvent.recordedAt ??= new Date().toISOString();
  const validation = validateContract("capture-event", publicEvent);
  if (!validation.valid) return { recorded: false, diagnostics: validation.errors };
  const current = await readEvents(root);
  const records = current.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  if (records.some((record) => record.eventId === publicEvent.eventId)) return { recorded: false, duplicate: true, diagnostics: [] };
  const next = `${current}${JSON.stringify(publicEvent)}\n`;
  await commitTransaction(root, {
    id: `capture-${publicEvent.eventId}`,
    checks: [{ path: EVENT_PATH, expectedHash: current ? hash(current) : null }],
    writes: [{ path: EVENT_PATH, value: next, encoding: "utf8" }],
  });
  return { recorded: true, diagnostics: [] };
}

export async function recoverCaptureFromReceipt(root, receipt) {
  if (!receipt?.attemptId) return { recorded: false, diagnostics: ["receipt has no attemptId"] };
  return captureEvent(root, {
    eventId: `attempt-${receipt.attemptId}`,
    kind: "practice-assessed",
    courseUid: receipt.courseUid,
    lessonUid: receipt.lessonUid,
    attemptId: receipt.attemptId,
    outcome: receipt.verdict ?? receipt.outcome,
    format: receipt.format,
    recordedAt: receipt.assessedAt ?? receipt.committedAt ?? new Date().toISOString(),
  });
}
