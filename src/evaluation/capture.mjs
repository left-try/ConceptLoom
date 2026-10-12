import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import { resolveContainedPath } from "../storage/paths.mjs";
import { assertRecovery, recoverTransactions, withWorkspaceLock } from "../storage/transactions.mjs";

export const outboxPath = ".concept-loom/evaluation/events.jsonl";
const ajv = new Ajv2020({ allErrors: true });
ajv.addFormat("date-time", value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value.replace(/Z$/, value.includes(".") ? "Z" : ".000Z"));
const validators = new Map(["capture-event", "eval-result"].map(name => [name,
  ajv.compile(JSON.parse(readFileSync(new URL(`../../schemas/${name}.schema.json`, import.meta.url), "utf8"))),
]));

export function validateContract(name, value) {
  const validate = validators.get(name);
  if (!validate) return { valid: false, errors: [{ instancePath: "", keyword: "contract", message: "unknown contract" }] };
  const valid = validate(value);
  // Keep validation diagnostics structural; rejected values may contain secrets.
  return { valid, errors: valid ? [] : validate.errors.map(({ instancePath, keyword, message }) => ({ instancePath, keyword, message })) };
}

// Intentionally no free text, assessment bodies, arbitrary input/output objects,
// grading metadata, token IDs, or evidence history. New fields require review.
const scalarFields = ["schemaVersion", "eventId", "eventType", "timestamp", "parentId", "runId", "sessionId", "courseUid", "lessonUid", "nodeUid", "host", "promptId", "promptDigest", "knowledgeProfileVersion", "status", "model", "generationLatencyMs"];
function pick(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(fields.filter(field => Object.hasOwn(value, field)).map(field => [field, value[field]]));
}
function publicEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return event;
  const projected = pick(event, scalarFields);
  if (Object.hasOwn(event, "sourceHashes")) projected.sourceHashes = Array.isArray(event.sourceHashes) ? [...event.sourceHashes] : event.sourceHashes;
  if (Object.hasOwn(event, "input")) projected.input = pick(event.input, ["attemptId", "format", "hintUsed"]);
  if (Object.hasOwn(event, "output")) projected.output = pick(event.output, ["outcome", "revision", "phase", "format"]);
  if (Object.hasOwn(event, "artifacts")) projected.artifacts = Array.isArray(event.artifacts)
    ? event.artifacts.map(artifact => pick(artifact, ["path", "contentHash"])) : event.artifacts;
  if (event.tokenUsage?.source === "provider-reported") projected.tokenUsage = pick(event.tokenUsage, ["source", "inputTokens", "outputTokens", "totalTokens"]);
  return projected;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function failure(code) { return { recorded: false, diagnostics: [{ severity: "error", code }] }; }

export async function captureEvent(root, event) {
  const projected = publicEvent(event);
  if (!validateContract("capture-event", projected).valid) return failure("CAPTURE_INVALID");
  // Publication requires the future artifact-commit tool, never a model claim.
  if (projected.eventType === "lesson-published") return failure("CAPTURE_REQUIRES_ARTIFACT");
  try {
    return await withWorkspaceLock(root, async () => {
      const path = await resolveContainedPath(root, outboxPath, { create: true });
      let text;
      try { text = await fs.readFile(path, "utf8"); }
      catch (error) { if (error.code !== "ENOENT") throw error; text = ""; }
      let rows;
      try {
        if (text && !text.endsWith("\n")) return failure("CAPTURE_OUTBOX_INVALID");
        rows = text ? text.trimEnd().split("\n").map(line => JSON.parse(line)) : [];
        if (rows.some(row => !validateContract("capture-event", row).valid)) return failure("CAPTURE_OUTBOX_INVALID");
      } catch { return failure("CAPTURE_OUTBOX_INVALID"); }
      const existing = rows.find(row => row.eventId === projected.eventId);
      if (existing) return JSON.stringify(canonical(existing)) === JSON.stringify(canonical(projected))
        ? { recorded: false, diagnostics: [] } : failure("CAPTURE_EVENT_CONFLICT");
      const handle = await fs.open(path, "a");
      try { await handle.writeFile(`${JSON.stringify(projected)}\n`, "utf8"); await handle.sync(); }
      finally { await handle.close(); }
      return { recorded: true, diagnostics: [] };
    });
  } catch (error) {
    // Do not expose exception text or receipt contents in a public diagnostic.
    return failure(error.code === "OUTSIDE_WORKSPACE" ? "OUTSIDE_WORKSPACE" : "CAPTURE_OUTBOX_WRITE_FAILED");
  }
}

export function assessmentCapturePointer(attemptId, host = "other") {
  return { eventId: `practice-${attemptId}`, receiptPath: `.concept-loom/assessments/attempts/${attemptId}.json`, outboxPath, host };
}
function assessmentEvent(receipt) {
  return {
    schemaVersion: 1, eventId: assessmentCapturePointer(receipt.attemptId).eventId, eventType: "practice-assessed", timestamp: receipt.assessedAt,
    sessionId: receipt.learningState.sessionId, host: receipt.capture?.host ?? "other", status: "completed",
    input: { attemptId: receipt.attemptId, format: receipt.assessment.format, hintUsed: receipt.input.hintUsed ?? false },
    output: { outcome: receipt.assessment.outcome, revision: receipt.learningState.revision },
  };
}
export async function captureAssessment(root, receipt) {
  const pointer = assessmentCapturePointer(receipt.attemptId, receipt.capture?.host ?? "other");
  const result = await captureEvent(root, assessmentEvent(receipt));
  return { ...pointer, diagnostics: result.diagnostics };
}
function restoreCapturePointer(eventId) {
  return { eventId, receiptPath: `.concept-loom/capture/restores/${eventId}.json`, outboxPath };
}
async function persistRestoreReceipt(root, receiptPath, event) {
  const destination = await resolveContainedPath(root, receiptPath, { create: true });
  const temporary = await resolveContainedPath(root, `${receiptPath}.${randomUUID()}.tmp`);
  // Optional capture receipts must not leave a prepared global learning journal.
  // Publish only a fully written, synced factual descriptor under the F1 lock.
  try {
    const handle = await fs.open(temporary, "wx");
    try { await handle.writeFile(`${JSON.stringify({ schemaVersion: 1, event })}\n`, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temporary, destination);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}
export async function recoverCapture(root, { attemptId, eventId } = {}) {
  if (eventId !== undefined) {
    if (attemptId !== undefined || typeof eventId !== "string" || !/^restore-[a-z0-9_-]{1,100}$/i.test(eventId)) return failure("CAPTURE_INVALID_EVENT");
    const pointer = restoreCapturePointer(eventId);
    try {
      return await withWorkspaceLock(root, async () => {
        assertRecovery(await recoverTransactions(root));
        const receipt = JSON.parse(await fs.readFile(await resolveContainedPath(root, pointer.receiptPath), "utf8"));
        if (receipt.schemaVersion !== 1 || !validateContract("capture-event", receipt.event).valid || receipt.event.eventId !== eventId || receipt.event.eventType !== "state-restored") return failure("CAPTURE_RECEIPT_INVALID");
        return { ...await captureEvent(root, receipt.event), ...pointer, timestamp: receipt.event.timestamp };
      });
    } catch (error) { return { ...failure(error.code === "ENOENT" ? "CAPTURE_RECEIPT_NOT_FOUND" : "CAPTURE_RECOVERY_FAILED"), ...pointer }; }
  }
  if (typeof attemptId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(attemptId)) return failure("CAPTURE_INVALID_ATTEMPT");
  try {
    return await withWorkspaceLock(root, async () => {
      assertRecovery(await recoverTransactions(root));
      const pointer = assessmentCapturePointer(attemptId);
      const receipt = JSON.parse(await fs.readFile(await resolveContainedPath(root, pointer.receiptPath), "utf8"));
      if (receipt.schemaVersion !== 1 || receipt.attemptId !== attemptId || !receipt.assessment || !receipt.learningState || !receipt.input) return failure("CAPTURE_RECEIPT_INVALID");
      const result = await captureEvent(root, assessmentEvent(receipt));
      return { ...result, ...assessmentCapturePointer(attemptId, receipt.capture?.host ?? "other") };
    });
  } catch (error) { return failure(error.code === "ENOENT" ? "CAPTURE_RECEIPT_NOT_FOUND" : "CAPTURE_RECOVERY_FAILED"); }
}
export async function captureRestoredState(root, state, { host = "other" } = {}) {
  const eventId = `restore-${randomUUID()}`;
  const event = { schemaVersion: 1, eventId, eventType: "state-restored", timestamp: new Date().toISOString(), host, sessionId: state.sessionId, status: "completed", input: {}, output: { revision: state.revision, phase: state.phase } };
  const pointer = { ...restoreCapturePointer(eventId), timestamp: event.timestamp };
  if (!validateContract("capture-event", event).valid) return { ...pointer, diagnostics: failure("CAPTURE_INVALID").diagnostics };
  try {
    return await withWorkspaceLock(root, async () => {
      await persistRestoreReceipt(root, pointer.receiptPath, event);
      return { ...pointer, diagnostics: (await captureEvent(root, event)).diagnostics };
    });
  } catch { return { ...pointer, diagnostics: failure("CAPTURE_RECEIPT_WRITE_FAILED").diagnostics }; }
}

export function tools(root) {
  return [
    {
      definition: { name: "loom_validate_contract", description: "Validate a local public capture-event or eval-result contract. Invalid contracts return valid=false and structural errors.", inputSchema: { type: "object", required: ["name", "value"], properties: { name: { enum: ["capture-event", "eval-result"] }, value: { type: "object" } } } },
      invoke: ({ name, value }) => validateContract(name, value),
    },
    {
      definition: { name: "loom_recover_capture", description: "Recover factual assessment capture by attemptId or restore capture by eventId from an existing committed receipt without grading or updating learner state.", inputSchema: { type: "object", additionalProperties: false, oneOf: [{ required: ["attemptId"], not: { required: ["eventId"] } }, { required: ["eventId"], not: { required: ["attemptId"] } }], properties: { attemptId: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" }, eventId: { type: "string", pattern: "^restore-[a-zA-Z0-9_-]{1,100}$" } } } },
      invoke: args => recoverCapture(root, args),
    },
  ];
}
