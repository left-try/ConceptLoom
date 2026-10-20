import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { commitTransaction } from "../storage/transactions.mjs";
import { resolveContainedPath } from "../storage/paths.mjs";
import { updateKnowledge } from "../knowledge/update.mjs";

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const COVERAGE = new Set(["full", "partial", "metadata", "summary", "excerpt", "external"]);
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const manifestPath = (uid) => `.concept-loom/sources/${uid}/manifest.json`;

async function readManifest(root, uid) {
  try { return JSON.parse(await readFile(join(root, manifestPath(uid)), "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

export async function importSource(root, input) {
  const uid = input.uid ?? `source-${createHash("sha1").update(input.resource).digest("hex").slice(0, 12)}`;
  if (typeof uid !== "string" || !ID.test(uid)) throw new Error("source uid must be a stable safe identifier");
  if (typeof input.resource !== "string" || !/^https?:\/\//.test(input.resource)) throw new Error("resource must be an http(s) URL");
  if (typeof input.title !== "string" || !input.title.trim()) throw new Error("source title is required");
  if (!COVERAGE.has(input.coverage)) throw new Error("coverage must be full, partial, metadata, summary, excerpt, or external");
  if (typeof input.content !== "string" && !input.localFile) throw new Error("content or localFile is required");
  const localPath = input.localFile ? await resolveContainedPath(root, input.localFile) : null;
  const content = input.content ?? await readFile(localPath, "utf8");
  const contentHash = hash(content);
  const previous = await readManifest(root, uid);
  if (previous?.versions?.some((version) => version.contentHash === contentHash)) return previous;
  if (input.receipt?.openedResource && input.receipt.openedResource !== input.resource) throw new Error("research receipt openedResource must match the imported canonical resource");
  if (input.receipt?.contentHash && input.receipt.contentHash !== contentHash) throw new Error("research receipt contentHash does not match imported content");
  if (input.receipt?.coverage && input.receipt.coverage !== input.coverage) throw new Error("research receipt coverage does not match the declared coverage");
  const receipt = {
    query: input.receipt?.query ?? "",
    openedResource: input.receipt?.openedResource ?? input.resource,
    fetchedAt: input.receipt?.fetchedAt ?? new Date().toISOString(),
    representation: input.receipt?.representation ?? input.coverage,
    coverage: input.receipt?.coverage ?? input.coverage,
    contentHash,
    locators: input.receipt?.locators ?? [],
    limitations: input.receipt?.limitations ?? [],
  };
  const version = { contentHash, version: input.version ?? String((previous?.versions?.length ?? 0) + 1), importedAt: new Date().toISOString(), coverage: input.coverage, assetPath: `.concept-loom/sources/${uid}/${contentHash.slice(7)}.md` };
  const manifest = {
    schemaVersion: 1, uid, canonicalResource: input.resource, title: input.title.trim(), author: input.author ?? null,
    language: input.language ?? "und", coverage: input.coverage, currentContentHash: contentHash,
    originalStorage: input.coverage === "external" ? "external" : "asset", receipt,
    versions: [...(previous?.versions ?? []), version], revision: (previous?.revision ?? 0) + 1,
  };
  await mkdir(join(root, ".concept-loom", "sources", uid), { recursive: true });
  await mkdir(dirname(join(root, version.assetPath)), { recursive: true });
  await writeFile(join(root, version.assetPath), content, "utf8");
  await commitTransaction(root, {
    id: `source-${uid}-${contentHash.slice(7)}`,
    checks: [{ path: manifestPath(uid), expectedRevision: previous?.revision ?? null }],
    writes: [{ path: manifestPath(uid), value: manifest, encoding: "json" }],
  });
  const knowledgeRoot = join(root, "vault", "Knowledge");
  const knowledgeAsset = join(knowledgeRoot, "assets", uid, contentHash.slice(7) + ".md");
  const reference = join(knowledgeRoot, "sources", uid + ".md");
  await mkdir(dirname(knowledgeAsset), { recursive: true });
  await writeFile(knowledgeAsset, content, "utf8");
  await mkdir(dirname(reference), { recursive: true });
  const generatedReference = [
    `Canonical resource: ${input.resource}`,
    `Coverage: ${input.coverage}.`,
    `Current content: [[assets/${uid}/${contentHash.slice(7)}]]`,
    ...(receipt.limitations.length ? ["", "Limitations:", ...receipt.limitations.map((item) => `- ${item}`)] : []),
  ].join("\n");
  try {
    const existing = await readFile(reference, "utf8");
    await updateKnowledge(root, { path: `sources/${uid}.md`, expectedHash: createHash("sha256").update(existing).digest("hex"), blockId: `source-${uid}`, generatedBody: generatedReference });
  }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const quote = (value) => JSON.stringify(value);
    const note = [
      "---", "type: Reference", `title: ${quote(input.title.trim())}`, "conceptloom:", "  profile: conceptloom/1", `  uid: ${uid}`, "---", "",
      `<!-- conceptloom:generated:source-${uid}:start -->`, generatedReference, `<!-- conceptloom:generated:source-${uid}:end -->`, "",
    ].join("\n");
    await writeFile(reference, note, "utf8");
  }
  return manifest;
}

export async function getSource(root, { sourceUid }) {
  const manifest = await readManifest(root, sourceUid);
  if (!manifest) throw new Error(`source '${sourceUid}' was not found`);
  return manifest;
}
