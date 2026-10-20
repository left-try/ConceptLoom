import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importSource, getSource } from "../src/sources/import.mjs";
import { indexKnowledge } from "../src/knowledge/index.mjs";

test("imports immutable source versions with coverage and an Obsidian reference", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-source-"));
  const first = await importSource(root, { uid: "primary-docs", resource: "https://docs.example.test/transactions", title: "Transactions", coverage: "partial", content: "Read committed permits concurrent writes.", receipt: { query: "transaction isolation", openedResource: "https://docs.example.test/transactions", representation: "raw", coverage: "partial", locators: [{ kind: "heading", value: "Isolation" }], limitations: ["Only one section imported."] } });
  const second = await importSource(root, { uid: "primary-docs", resource: "https://docs.example.test/transactions", title: "Transactions", version: "2", coverage: "full", content: "A fuller source with serializable isolation." });
  assert.equal(second.versions.length, 2);
  assert.equal(await getSource(root, { sourceUid: "primary-docs" }).then(value => value.currentContentHash), second.currentContentHash);
  const reference = await readFile(join(root, "vault", "Knowledge", "sources", "primary-docs.md"), "utf8");
  assert.match(reference, /partial|full/);
  const index = await indexKnowledge(root);
  assert.ok(index.nodes.some(node => node.type === "Reference" && node.uid === "primary-docs"));
  assert.ok(index.nodes.some(node => node.type === "Source Fragment"));
});

test("rejects source paths outside workspace and provenance mismatches", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-source-"));
  await assert.rejects(importSource(root, { uid: "escape", resource: "https://example.test/a", title: "A", coverage: "full", localFile: "../secret.md", receipt: {} }), { code: "OUTSIDE_WORKSPACE" });
  await assert.rejects(importSource(root, { uid: "wrong-proof", resource: "https://example.test/a", title: "A", coverage: "full", content: "abc", receipt: { openedResource: "https://example.test/b" } }), /openedResource/);
});
