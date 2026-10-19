import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateContract } from "./capture.mjs";
import { readCatalog } from "../prompts/loader.mjs";
import { resolveContainedPath } from "../storage/paths.mjs";
import { withWorkspaceLock } from "../storage/transactions.mjs";

export const eventsPath = ".concept-loom/evaluation/events.jsonl";
export const resultsPath = ".concept-loom/evaluation/results.jsonl";
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const sha256 = value => createHash("sha256").update(value).digest("hex");
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const issue = (code, message, line) => ({ severity: "error", code, message, ...(line ? { line } : {}) });

export async function readJsonl(path, validator) {
  let text;
  try { text = await fs.readFile(path, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return { rows: [], diagnostics: [] }; throw error; }
  const rows = [];
  const diagnostics = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.replace(/^\uFEFF/, "");
    if (!line.trim()) continue;
    let value;
    try { value = JSON.parse(line); }
    catch { diagnostics.push(issue("JSONL_LINE_INVALID", "JSONL line is malformed and was preserved.", index + 1)); continue; }
    if (validator && !validator(value)) { diagnostics.push(issue("JSONL_RECORD_INVALID", "JSONL record failed contract validation and was preserved.", index + 1)); continue; }
    rows.push(value);
  }
  return { rows, diagnostics };
}

async function sourceRevisionAvailable(root, expectedHash) {
  if (!hashPattern.test(expectedHash)) return false;
  let catalog;
  try { catalog = JSON.parse(await fs.readFile(await resolveContainedPath(root, ".concept-loom/sources/catalog.json"), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  for (const source of Object.values(catalog.sources ?? {})) for (const version of source.versions ?? []) {
    const hash = version.contentHash?.startsWith("sha256:") ? version.contentHash : `sha256:${version.contentHash ?? ""}`;
    if (hash !== expectedHash || !version.assetPath) continue;
    try {
      const path = await resolveContainedPath(root, `vault/Knowledge/${version.assetPath}`);
      const bytes = await fs.readFile(path);
      if (`sha256:${sha256(bytes)}` === expectedHash) return true;
    } catch (error) { if (error.code !== "ENOENT" && error.code !== "OUTSIDE_WORKSPACE") throw error; }
  }
  return false;
}

async function promptRevisionAvailable(root, event, promptDigests) {
  if (!event.promptId && !event.promptDigest) return true;
  if (!event.promptDigest || !hashPattern.test(event.promptDigest)) return false;
  let expected = promptDigests?.[event.promptId];
  if (!expected) {
    const catalog = await readCatalog({ root });
    expected = catalog.find(prompt => prompt.id === event.promptId)?.digest;
    if (!expected && !event.promptId) expected = catalog.find(prompt => prompt.digest === event.promptDigest)?.digest;
  }
  return expected === event.promptDigest;
}

function recordFor(event, identity, status, diagnostics, evaluated = {}) {
  const resultId = `result-${sha256(JSON.stringify(canonical(identity)))}`;
  return {
    identity,
    result: {
      schemaVersion: 1,
      resultId,
      eventId: identity.eventId,
      evaluatorId: identity.evaluatorId,
      evaluatorVersion: identity.evaluatorVersion,
      timestamp: event?.timestamp ?? new Date().toISOString(),
      status,
      ...(status === "completed" ? { passed: evaluated.passed === true } : {}),
      ...(typeof evaluated.score === "number" ? { score: evaluated.score } : {}),
      ...(evaluated.dimensions ? { dimensions: evaluated.dimensions } : {}),
      ...(typeof evaluated.rationale === "string" ? { rationale: evaluated.rationale } : {}),
      ...(diagnostics.length ? { diagnostics: diagnostics.map(({ severity, code, message }) => ({ severity, code, ...(message ? { message } : {}) })) } : {}),
    },
  };
}

export async function replayEvents(root, {
  eventIds,
  evaluatorSetVersion,
  evaluatorId = "deterministic-contracts",
  evaluatorPromptDigest,
  promptDigests,
  mode = "deterministic",
  evaluate,
  sourceLookup,
} = {}) {
  if (mode !== "deterministic") throw new Error("only deterministic replay is supported");
  if (!Array.isArray(eventIds) || !eventIds.length || eventIds.some(id => typeof id !== "string" || !id) || new Set(eventIds).size !== eventIds.length) throw new Error("explicit unique eventIds are required");
  if (typeof evaluatorSetVersion !== "string" || !evaluatorSetVersion.trim()) throw new Error("evaluatorSetVersion is required");
  const eventFile = await resolveContainedPath(root, eventsPath);
  const eventRead = await readJsonl(eventFile, row => validateContract("capture-event", row).valid);
  const resultFile = await resolveContainedPath(root, resultsPath, { create: true });
  const priorRead = await readJsonl(resultFile, row => row && row.identity && validateContract("eval-result", row.result).valid);
  const diagnostics = [...eventRead.diagnostics.map(item => ({ ...item, code: item.code.replace("JSONL", "CAPTURE") })), ...priorRead.diagnostics.map(item => ({ ...item, code: item.code.replace("JSONL", "RESULT") }))];
  const eventById = new Map(eventRead.rows.map(row => [row.eventId, row]));
  const returned = [];
  await withWorkspaceLock(root, async () => {
    let latest = await readJsonl(resultFile, row => row && row.identity && validateContract("eval-result", row.result).valid);
    const existing = [...latest.rows];
    for (const eventId of eventIds) {
      const event = eventById.get(eventId);
      const sourceHashes = [...(event?.sourceHashes ?? [])].sort();
      const identity = {
        eventId,
        evaluatorId,
        evaluatorVersion: evaluatorSetVersion,
        sourceHashes,
        promptDigest: evaluatorPromptDigest ?? event?.promptDigest ?? null,
        ...(event?.promptDigest ? { sourcePromptDigest: event.promptDigest } : {}),
      };
      const cached = existing.find(row => JSON.stringify(canonical(row.identity)) === JSON.stringify(canonical(identity)) && row.result.status === "completed");
      if (cached) { returned.push(cached); continue; }
      const problems = [];
      if (!event) problems.push(issue("EVENT_MISSING", `Requested event ${eventId} is not available.`));
      if (event) {
        for (const contentHash of sourceHashes) {
          const available = sourceLookup ? await sourceLookup(contentHash, event) : await sourceRevisionAvailable(root, contentHash);
          if (!available) problems.push(issue("SOURCE_REVISION_MISSING", `Immutable source revision ${contentHash} is unavailable.`));
        }
        if (!await promptRevisionAvailable(root, event, promptDigests)) problems.push(issue("PROMPT_REVISION_MISSING", "The exact source prompt revision is unavailable."));
      }
      let record;
      if (problems.length) record = recordFor(event, identity, "error", problems);
      else {
        const validation = validateContract("capture-event", event);
        if (!validation.valid) record = recordFor(event, identity, "error", [issue("CAPTURE_CONTRACT_INVALID", "Capture event failed structural validation.")]);
        else {
          try {
            const evaluated = evaluate ? await evaluate(event) : { passed: true };
            if (evaluated?.status === "error" || evaluated?.status === "skipped") record = recordFor(event, identity, evaluated.status, evaluated.diagnostics ?? []);
            else record = recordFor(event, identity, "completed", evaluated?.diagnostics ?? [], evaluated ?? {});
          } catch { record = recordFor(event, identity, "error", [issue("EVALUATOR_ERROR", "Deterministic evaluator failed.")]); }
        }
      }
      if (!validateContract("eval-result", record.result).valid) throw new Error("replay generated an invalid EvalResult");
      await fs.appendFile(resultFile, `${JSON.stringify(record)}\n`, "utf8");
      existing.push(record);
      returned.push(record);
    }
  });
  return { results: returned, diagnostics };
}
