import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { readFile, stat, symlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { importSource } from "../src/sources/import.mjs";
import { chunkSource } from "../src/sources/chunks.mjs";
import { prepareSource } from "../src/sources/import.mjs";
import { makeWorkspace } from "./helpers/knowledge.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const receipt = (content, { representation = "raw", coverage = "full" } = {}) => ({
  schemaVersion: 1,
  query: "linear algebra reference",
  openedResource: "https://example.test/linear-algebra",
  fetchedAt: "2026-10-13T08:00:00.000Z",
  representation,
  coverage,
  contentHash: content === undefined ? undefined : hash(content),
  locators: [],
  limitations: [],
});

test("publishes versioned schemas for source manifests and research receipts", async () => {
  const manifestSchema = JSON.parse(await readFile(new URL("../schemas/source-manifest.schema.json", import.meta.url), "utf8"));
  const receiptSchema = JSON.parse(await readFile(new URL("../schemas/research-receipt.schema.json", import.meta.url), "utf8"));
  const ajv = new Ajv({ strict: false });
  const validateManifest = ajv.compile(manifestSchema);
  const validateReceipt = ajv.compile(receiptSchema);
  const validReceipt = {
    schemaVersion: 1, query: "vector definition", openedResource: "https://example.test/book",
    fetchedAt: "2026-10-13T08:00:00.000Z", representation: "raw", coverage: "full",
    contentHash: "a".repeat(64), locators: [{ page: 1, contentHash: "a".repeat(64) }], limitations: [],
  };
  assert.equal(validateReceipt(validReceipt), true, JSON.stringify(validateReceipt.errors));
  assert.equal(validateReceipt({ ...validReceipt, schemaVersion: 9 }), false);
  assert.equal(validateManifest({
    schemaVersion: 1, uid: "source-a", canonicalResource: "https://example.test/book", title: "Book",
    coverage: "full", currentContentHash: "a".repeat(64), status: "ready",
    versions: [{ contentHash: "a".repeat(64), coverage: "full", originalStorage: "asset", assetPath: "assets/source-a/a" }],
  }), true);
  assert.equal(validateManifest({ schemaVersion: 1, uid: "../escape", canonicalResource: "x", title: "x", coverage: "full", versions: [] }), false);
});

test("imports source bytes as a hash-addressed immutable asset with provenance", async t => {
  const root = await makeWorkspace(t);
  const content = "Chapter 1\nVectors have magnitude and direction.\n";
  const source = await importSource(root, {
    uid: "linear-algebra", resource: "https://example.test/linear-algebra", title: "Linear Algebra",
    author: "A. Author", language: "en", version: "1", coverage: "full", content,
    receipt: receipt(content),
  });
  const version = source.versions.find(item => item.contentHash === hash(content));
  assert.ok(version);
  assert.equal(version.originalStorage, "asset");
  const asset = isAbsolute(version.assetPath) ? version.assetPath : resolve(root, "vault/Knowledge", version.assetPath);
  assert.equal(await readFile(asset, "utf8"), content);
  assert.equal(source.uid, "linear-algebra");
  assert.equal(source.receipt.openedResource, "https://example.test/linear-algebra");
});

test("reimporting identical content and receipt is idempotent", async t => {
  const root = await makeWorkspace(t);
  const input = {
    uid: "same-source", resource: "https://example.test/same", title: "Same", coverage: "full",
    content: "stable bytes", receipt: receipt("stable bytes"),
  };
  const first = await importSource(root, input);
  const second = await importSource(root, input);
  assert.equal(second.uid, first.uid);
  assert.equal(second.revision, first.revision);
  assert.deepEqual(second.versions, first.versions);
  assert.equal(second.versions.length, 1);
});

test("a new source version preserves earlier immutable bytes and locators", async t => {
  const root = await makeWorkspace(t);
  const firstContent = "First edition: page 2.";
  const first = await importSource(root, {
    uid: "versioned-source", resource: "https://example.test/book", title: "Book", version: "1",
    coverage: "partial", content: firstContent,
    receipt: { ...receipt(firstContent, { coverage: "partial" }), locators: [{ page: 2, section: "Vectors" }] },
  });
  const secondContent = "Second edition: page 3.";
  const second = await importSource(root, {
    uid: "versioned-source", resource: "https://example.test/book", title: "Book", version: "2",
    coverage: "full", content: secondContent, receipt: receipt(secondContent),
  });
  assert.equal(second.versions.length, 2);
  assert.ok(second.versions.some(item => item.contentHash === hash(firstContent)));
  assert.ok(second.versions.some(item => item.contentHash === hash(secondContent)));
  const oldVersion = second.versions.find(item => item.contentHash === hash(firstContent));
  assert.equal(oldVersion.receipt.locators[0].contentHash, hash(firstContent));
  const oldAsset = isAbsolute(oldVersion.assetPath) ? oldVersion.assetPath : resolve(root, "vault/Knowledge", oldVersion.assetPath);
  assert.equal(await readFile(oldAsset, "utf8"), firstContent);
});

test("metadata-only and summary sources do not claim full source access", async t => {
  const root = await makeWorkspace(t);
  const summary = "A short summary, not the book text.";
  const source = await importSource(root, {
    uid: "metadata-only", resource: "https://example.test/book", title: "Book", coverage: "summary",
    content: summary, receipt: receipt(summary, { representation: "summary", coverage: "summary" }),
  });
  assert.equal(source.coverage, "summary");
  assert.equal(source.receipt.representation, "summary");
  assert.notEqual(source.coverage, "full");
});

test("unknown coverage remains unknown instead of being upgraded", async t => {
  const root = await makeWorkspace(t);
  const source = await importSource(root, {
    uid: "unknown-coverage", resource: "https://example.test/metadata", title: "Metadata",
    coverage: "unknown", receipt: receipt(undefined, { representation: "metadata", coverage: "unknown" }),
  });
  assert.equal(source.coverage, "unknown");
  assert.equal(source.versions[0].originalStorage, "external");
  assert.equal(source.versions[0].contentHash, undefined);
});

test("copies an in-workspace local source into a versioned asset without modifying the input file", async t => {
  const root = await makeWorkspace(t, { "incoming/reference.txt": "Original local source bytes." });
  const localFile = join(root, "incoming/reference.txt");
  const before = await readFile(localFile);
  const source = await importSource(root, {
    uid: "local-reference", resource: "file:///incoming/reference.txt", title: "Local reference",
    coverage: "full", localFile, receipt: {
      ...receipt(undefined), openedResource: "file:///incoming/reference.txt", contentHash: hash(before),
    },
  });
  const version = source.versions.find(item => item.contentHash === hash(before));
  assert.equal(version.originalStorage, "asset");
  const asset = isAbsolute(version.assetPath) ? version.assetPath : resolve(root, "vault/Knowledge", version.assetPath);
  assert.deepEqual(await readFile(asset), before);
  assert.deepEqual(await readFile(localFile), before);
});

test("rejects source IDs and local paths that escape the workspace", async t => {
  const root = await makeWorkspace(t);
  const outside = await makeWorkspace(t);
  await assert.rejects(importSource(root, {
    uid: "../outside", resource: "https://example.test/x", title: "Escape", coverage: "full",
    content: "x", receipt: receipt("x"),
  }), error => error.code === "OUTSIDE_WORKSPACE" || /uid|path|workspace/i.test(error.message));
  await assert.rejects(importSource(root, {
    uid: "linked-source", resource: "file:///outside", title: "Escape", coverage: "full",
    localFile: join(outside, "secret.pdf"), receipt: receipt(undefined, { representation: "raw" }),
  }), error => error.code === "OUTSIDE_WORKSPACE" || /outside|workspace/i.test(error.message));
});

test("rejects a symlinked source asset that resolves outside the workspace", async t => {
  const root = await makeWorkspace(t);
  const outside = await makeWorkspace(t, { "secret.pdf": "private source" });
  const link = join(root, "outside.pdf");
  try { await symlink(join(outside, "secret.pdf"), link, "file"); }
  catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) return t.skip(`symlink unavailable: ${error.code}`);
    throw error;
  }
  await assert.rejects(importSource(root, {
    uid: "symlink-source", resource: "file:///outside.pdf", title: "Escape", coverage: "full",
    localFile: link, receipt: receipt(undefined, { representation: "raw" }),
  }), error => error.code === "OUTSIDE_WORKSPACE" || /outside|workspace|symbolic/i.test(error.message));
});

test("rejects a receipt hash that does not match the source bytes", async t => {
  const root = await makeWorkspace(t);
  await assert.rejects(importSource(root, {
    uid: "mismatched-receipt", resource: "https://example.test/book", title: "Book", coverage: "full",
    content: "actual bytes", receipt: { ...receipt("actual bytes"), contentHash: hash("different bytes") },
  }), /hash|receipt|content/i);
});

test("enforces the configured local asset size limit before writing an import", async t => {
  const root = await makeWorkspace(t);
  const content = "0123456789";
  await assert.rejects(importSource(root, {
    uid: "oversized", resource: "https://example.test/large", title: "Large", coverage: "full",
    content, maxAssetBytes: 4, receipt: receipt(content),
  }), error => error.code === "SOURCE_TOO_LARGE" || /size|large|limit/i.test(error.message));
  const catalog = await readFile(join(root, ".concept-loom/sources/catalog.json"), "utf8").catch(error => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  assert.doesNotMatch(catalog, /oversized/);
});

test("creates deterministic chunks at section boundaries with exact source locators", () => {
  const chunks = chunkSource({
    sourceUid: "source-a", contentHash: "sha256:abc123", maxChars: 120,
    sections: [
      { heading: "Vectors", text: "Magnitude and direction.", page: 2, printedPage: "14" },
      { heading: "Matrices", text: "Rows and columns.", page: 3 },
    ],
  });
  assert.equal(chunks.length, 2);
  assert.notEqual(chunks[0].id, chunks[1].id);
  assert.equal(chunks[0].sourceUid, "source-a");
  assert.equal(chunks[0].contentHash, "sha256:abc123");
  assert.equal(chunks[0].locator.page, 2);
  assert.equal(chunks[0].locator.printedPage, "14");
  assert.equal(chunks[1].locator.page, 3);
});

test("splits oversized sections at paragraph boundaries deterministically", () => {
  const input = {
    sourceUid: "long-source", contentHash: "sha256:long", maxChars: 32,
    sections: [{ heading: "Long", page: 7, text: "First paragraph is here.\n\nSecond paragraph is here.\n\nThird paragraph is here." }],
  };
  const first = chunkSource(input);
  const second = chunkSource(input);
  assert.deepEqual(first, second);
  assert.ok(first.length > 1);
  assert.ok(first.every(chunk => chunk.text.length <= 32));
  assert.ok(first.every(chunk => chunk.locator.page === 7));
});

test("does not turn a summary or metadata-only representation into source evidence chunks", () => {
  assert.deepEqual(chunkSource({
    sourceUid: "metadata", contentHash: undefined, representation: "metadata", sections: [],
  }), []);
  assert.deepEqual(chunkSource({
    sourceUid: "summary", contentHash: "sha256:summary", representation: "summary",
    sections: [{ heading: "Summary", text: "A short summary." }],
  }), []);
});

test("prepares extraction artifacts without changing the original asset", async t => {
  const root = await makeWorkspace(t);
  const original = "Original bytes never change.";
  const source = await importSource(root, {
    uid: "prepared-source", resource: "https://example.test/source", title: "Source", coverage: "full",
    content: original, receipt: receipt(original),
  });
  const asset = isAbsolute(source.versions[0].assetPath) ? source.versions[0].assetPath : resolve(root, "vault/Knowledge", source.versions[0].assetPath);
  const before = await readFile(asset);
  const prepared = await prepareSource(root, {
    sourceUid: source.uid,
    extraction: {
      representation: "extracted", tool: "fixture-extractor", toolVersion: "1.0.0",
      sections: [{ heading: "Section", text: "Extracted text.", page: 1 }],
    },
  });
  assert.equal(await readFile(asset, "utf8"), before.toString("utf8"));
  assert.ok(prepared.extraction.contentHash);
  assert.equal(prepared.extraction.sections[0].locator.page, 1);
  assert.equal((await stat(asset)).isFile(), true);
});

test("surfaces an extraction failure without marking the source prepared", async t => {
  const root = await makeWorkspace(t);
  const content = "Original.";
  const source = await importSource(root, {
    uid: "failed-extraction", resource: "https://example.test/file", title: "File", coverage: "partial",
    content, receipt: receipt(content, { coverage: "partial" }),
  });
  const result = await prepareSource(root, {
    sourceUid: source.uid,
    extraction: { status: "failed", error: "No readable text found.", sections: [] },
  });
  assert.equal(result.extraction.status, "failed");
  assert.ok(result.diagnostics.some(item => /readable text/i.test(item.message)));
});
