import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { updateKnowledge } from "../src/knowledge/update.mjs";
import { makeWorkspace, note } from "./helpers/knowledge.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const path = "vault/Knowledge/concepts/curated.md";
const original = note("Concept", "Curated concept", "Human-authored paragraph.\nSecond line.\n",
  "vendor_metadata:\n  preserve: true\n");

test("updates a generated block while preserving the surrounding user body and unknown YAML", async t => {
  const root = await makeWorkspace(t, { [path]: original });
  await updateKnowledge(root, {
    path: "concepts/curated.md", expectedHash: hash(original), metadataPatch: { description: "Generated description" },
    blockId: "source-summary", generatedBody: "Imported from [the source](../references/book.md).",
  });
  const updated = await readFile(join(root, path), "utf8");
  assert.match(updated, /Human-authored paragraph\.\nSecond line\./);
  assert.match(updated, /vendor_metadata:\n  preserve: true/);
  assert.match(updated, /<!-- conceptloom:generated:source-summary:start -->/);
  assert.match(updated, /Imported from \[the source\]/);
});

test("rejects a stale expected hash without changing a single byte", async t => {
  const root = await makeWorkspace(t, { [path]: original });
  await assert.rejects(updateKnowledge(root, {
    path: "concepts/curated.md", expectedHash: "stale-hash", blockId: "summary", generatedBody: "New text.",
  }), /hash|conflict|revision/i);
  assert.equal(await readFile(join(root, path), "utf8"), original);
});

test("rejects duplicate generated markers without changing the note", async t => {
  const malformed = `${original}\n<!-- conceptloom:generated:summary:start -->\nFirst\n<!-- conceptloom:generated:summary:end -->\n<!-- conceptloom:generated:summary:start -->\nSecond\n<!-- conceptloom:generated:summary:end -->\n`;
  const root = await makeWorkspace(t, { [path]: malformed });
  await assert.rejects(updateKnowledge(root, {
    path: "concepts/curated.md", expectedHash: hash(malformed), blockId: "summary", generatedBody: "Updated.",
  }), /duplicate|marker/i);
  assert.equal(await readFile(join(root, path), "utf8"), malformed);
});

test("rejects incomplete or mismatched generated markers without overwriting them", async t => {
  const malformed = `${original}\n<!-- conceptloom:generated:a:start -->\nOld generated text.\n`;
  const root = await makeWorkspace(t, { [path]: malformed });
  await assert.rejects(updateKnowledge(root, {
    path: "concepts/curated.md", expectedHash: hash(malformed), blockId: "a", generatedBody: "Replacement.",
  }), /marker|generated block/i);
  assert.equal(await readFile(join(root, path), "utf8"), malformed);
});

test("rejects malformed YAML before applying metadata or generated content", async t => {
  const malformed = "---\ntype: Concept\ntitle: [invalid\n---\nHuman text.\n";
  const root = await makeWorkspace(t, { [path]: malformed });
  await assert.rejects(updateKnowledge(root, {
    path: "concepts/curated.md", expectedHash: hash(malformed), metadataPatch: { title: "Overwrite" },
    blockId: "summary", generatedBody: "New.",
  }), /yaml|frontmatter|parse/i);
  assert.equal(await readFile(join(root, path), "utf8"), malformed);
});

test("serializes concurrent updates and lets only one writer use a shared expected hash", async t => {
  const root = await makeWorkspace(t, { [path]: original });
  const writes = ["Writer A", "Writer B"].map(generatedBody => updateKnowledge(root, {
    path: "concepts/curated.md", expectedHash: hash(original), blockId: "summary", generatedBody,
  }));
  const results = await Promise.allSettled(writes);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(results.filter(item => item.status === "rejected").length, 1);
  const final = await readFile(join(root, path), "utf8");
  assert.match(final, /Human-authored paragraph/);
  assert.equal(/Writer A/.test(final) !== /Writer B/.test(final), true);
});

test("rejects update paths outside the workspace Knowledge bundle", async t => {
  const root = await makeWorkspace(t, { [path]: original });
  await assert.rejects(updateKnowledge(root, {
    path: "../../.concept-loom/assessments/private.json", expectedHash: "x", blockId: "a", generatedBody: "x",
  }), /outside|workspace|path/i);
});

test("returns the new content hash so the next update can use an optimistic guard", async t => {
  const root = await makeWorkspace(t, { [path]: original });
  const result = await updateKnowledge(root, {
    path: "concepts/curated.md", expectedHash: hash(original), blockId: "summary", generatedBody: "Fresh generated text.",
  });
  const bytes = await readFile(join(root, path));
  assert.equal(result.hash, hash(bytes));
  assert.notEqual(result.hash, hash(original));
});
