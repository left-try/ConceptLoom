import fs from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { resolveContainedPath } from "../storage/paths.mjs";
import { commitTransaction, withWorkspaceLock } from "../storage/transactions.mjs";

const catalogPath = ".concept-loom/sources/catalog.json";
const fail = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code });
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const allowedCoverage = new Set(["full", "partial", "summary", "metadata", "unknown"]);

async function catalog(root) {
  try { return JSON.parse(await fs.readFile(await resolveContainedPath(root, catalogPath), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return { schemaVersion: 1, revision: 0, sources: {} }; throw error; }
}

export async function importSource(root, input) {
  const uid = input.uid ?? `source-${sha256(Buffer.from(String(input.resource))).slice(0, 16)}`;
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(uid)) throw fail("OUTSIDE_WORKSPACE", "source uid must be a path-safe slug");
  if (typeof input.resource !== "string" || !input.resource.trim()) throw fail("INVALID_SOURCE", "resource is required");
  if (typeof input.title !== "string" || !input.title.trim()) throw fail("INVALID_SOURCE", "title is required");
  const coverage = allowedCoverage.has(input.coverage) ? input.coverage : "unknown";
  const receipt = structuredClone(input.receipt ?? {});
  const maxBytes = input.maxAssetBytes ?? 250 * 1024 * 1024;
  let bytes;
  if (input.content !== undefined) bytes = Buffer.isBuffer(input.content) ? Buffer.from(input.content) : Buffer.from(String(input.content), "utf8");
  else if (input.localFile) {
    const sourcePath = resolve(input.localFile);
    const canonicalRoot = await fs.realpath(resolve(root));
    const canonicalSource = await fs.realpath(sourcePath).catch(() => { throw fail("OUTSIDE_WORKSPACE", "local source file is missing or outside workspace"); });
    const rel = relative(canonicalRoot, canonicalSource);
    if (!rel || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || resolve(rel) === canonicalSource && rel.startsWith("..")) throw fail("OUTSIDE_WORKSPACE", "local source file must stay inside workspace");
    bytes = await fs.readFile(canonicalSource);
  }
  if (bytes?.length > maxBytes) throw fail("SOURCE_TOO_LARGE", `source exceeds the ${maxBytes} byte asset limit`);
  const contentHash = bytes ? sha256(bytes) : undefined;
  if (receipt.contentHash && contentHash && receipt.contentHash.replace(/^sha256:/, "") !== contentHash) throw fail("SOURCE_HASH_MISMATCH", "receipt content hash does not match source bytes");
  if (contentHash) receipt.contentHash = contentHash;
  receipt.schemaVersion ??= 1;
  receipt.query ??= "";
  receipt.openedResource ??= input.resource;
  receipt.fetchedAt ??= new Date().toISOString();
  receipt.representation ??= bytes ? "raw" : "metadata";
  receipt.coverage = allowedCoverage.has(receipt.coverage) ? receipt.coverage : coverage;
  receipt.locators = Array.isArray(receipt.locators) ? receipt.locators : [];
  receipt.limitations = Array.isArray(receipt.limitations) ? receipt.limitations : [];
  if (contentHash) receipt.locators = receipt.locators.map(locator => ({ ...locator, contentHash }));
  return withWorkspaceLock(root, async () => {
    const assetRelative = contentHash ? `assets/${uid}/${contentHash}` : undefined;
    if (bytes) {
      const destination = await resolveContainedPath(root, `vault/Knowledge/${assetRelative}`, { create: true });
      try { await fs.writeFile(destination, bytes, { flag: "wx" }); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        const existing = await fs.readFile(destination);
        if (!existing.equals(bytes)) throw fail("SOURCE_ASSET_CONFLICT", "existing hash-addressed source asset has different bytes");
      }
    }
    const currentCatalog = await catalog(root);
    const prior = currentCatalog.sources[uid];
    if (prior && prior.canonicalResource !== input.resource) throw fail("SOURCE_ID_CONFLICT", "source uid already belongs to a different canonical resource");
    const version = contentHash && prior?.versions.find(item => item.contentHash === contentHash);
    if (version) return prior;
    const source = {
      schemaVersion: 1, uid, canonicalResource: input.resource, title: input.title,
      ...(input.author ? { author: input.author } : {}), ...(input.language ? { language: input.language } : {}),
      coverage, currentContentHash: contentHash, status: bytes ? "ready" : "metadata-only",
      revision: (prior?.revision ?? 0) + 1,
      versions: [...(prior?.versions ?? []), {
        ...(input.version ? { version: input.version } : {}), ...(contentHash ? { contentHash } : {}), coverage,
        originalStorage: bytes ? "asset" : "external", ...(assetRelative ? { assetPath: assetRelative } : {}), receipt,
      }], receipt,
    };
    const nextCatalog = { schemaVersion: 1, revision: currentCatalog.revision + 1, sources: { ...currentCatalog.sources, [uid]: source } };
    await commitTransaction(root, { writes: [{ path: catalogPath, encoding: "json", value: nextCatalog }] });
    return source;
  });
}

export async function prepareSource(root, { sourceUid, extraction }) {
  const currentCatalog = await catalog(root);
  const source = currentCatalog.sources[sourceUid];
  if (!source) throw fail("SOURCE_NOT_FOUND", `source ${sourceUid} not found`);
  if (extraction?.status === "failed") {
    const result = { ...source, extraction: { ...extraction, status: "failed" }, diagnostics: [{ severity: "error", code: "SOURCE_EXTRACTION_FAILED", message: extraction.error ?? "Extraction failed." }] };
    return result;
  }
  const currentVersion = [...source.versions].reverse().find(item => item.contentHash === source.currentContentHash);
  const sections = (extraction?.sections ?? []).map(section => ({ ...section, locator: { ...(section.locator ?? {}), ...(section.page !== undefined ? { page: section.page } : {}), ...(section.printedPage !== undefined ? { printedPage: section.printedPage } : {}), sourceUid, contentHash: currentVersion?.contentHash } }));
  const body = JSON.stringify({ schemaVersion: 1, sourceUid, contentHash: currentVersion?.contentHash, representation: extraction?.representation ?? "extracted", tool: extraction?.tool, toolVersion: extraction?.toolVersion, sections });
  const extractionHash = sha256(Buffer.from(body));
  const extractionPath = `.concept-loom/sources/extractions/${sourceUid}/${extractionHash}.json`;
  const destination = await resolveContainedPath(root, extractionPath, { create: true });
  await fs.writeFile(destination, `${body}\n`, { flag: "wx" }).catch(async error => { if (error.code !== "EEXIST") throw error; });
  return { ...source, extraction: { status: "ready", contentHash: extractionHash, sourceContentHash: currentVersion?.contentHash, sections }, diagnostics: [] };
}
