import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, readFile, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { exportKnowledge } from "../src/knowledge/export.mjs";
import { makeWorkspace, note, rootIndex } from "./helpers/knowledge.mjs";

const files = {
  "vault/Knowledge/index.md": rootIndex,
  "vault/Knowledge/concepts/vectors.md": note("Concept", "Vectors", "See [the book](../references/book.md).\n"),
  "vault/Knowledge/references/book.md": note("Reference", "Book", "Description.\n", "resource: https://example.test/book\n"),
  "vault/Knowledge/assets/book/scan.txt": "Synthetic source asset.",
  "vault/Personal/my-note.md": "# My note\nKeep my personal writing.\n",
  ".concept-loom/assessments/answer.json": JSON.stringify({ key: "private answer" }),
  ".concept-loom/evaluation/events.jsonl": JSON.stringify({ output: "private event" }),
};

test("exports an OKF bundle without Personal notes or private records", async t => {
  const root = await makeWorkspace(t, files);
  const result = await exportKnowledge(root, { format: "okf", destination: "exports/okf" });
  const output = join(root, "exports/okf");
  assert.ok(result.manifest.files.includes("index.md"));
  assert.equal(await readFile(join(output, "concepts/vectors.md"), "utf8"), files["vault/Knowledge/concepts/vectors.md"]);
  assert.equal(await readFile(join(output, "assets/book/scan.txt"), "utf8"), "Synthetic source asset.");
  await assert.rejects(readFile(join(output, "Personal/my-note.md")), { code: "ENOENT" });
  assert.equal(JSON.stringify(result).includes("private answer"), false);
  assert.equal(JSON.stringify(result).includes("private event"), false);
});

test("exports Personal only in explicit Obsidian mode", async t => {
  const root = await makeWorkspace(t, files);
  await exportKnowledge(root, { format: "obsidian", destination: "exports/obsidian", includePersonal: true });
  assert.equal(await readFile(join(root, "exports/obsidian/Personal/my-note.md"), "utf8"), files["vault/Personal/my-note.md"]);
});

test("does not silently include Personal in an Obsidian export without opt-in", async t => {
  const root = await makeWorkspace(t, files);
  await exportKnowledge(root, { format: "obsidian", destination: "exports/obsidian" });
  await assert.rejects(readFile(join(root, "exports/obsidian/Personal/my-note.md")), { code: "ENOENT" });
});

test("relative Markdown links and assets remain valid after relocating export", async t => {
  const root = await makeWorkspace(t, files);
  await exportKnowledge(root, { format: "okf", destination: "exports/portable" });
  const relocated = join(root, "moved", "knowledge-copy");
  await mkdir(join(root, "moved"), { recursive: true });
  const { cp } = await import("node:fs/promises");
  await cp(join(root, "exports/portable"), relocated, { recursive: true });
  const note = await readFile(join(relocated, "concepts/vectors.md"), "utf8");
  assert.match(note, /\.\.\/references\/book\.md/);
  assert.equal(await readFile(join(relocated, "references/book.md"), "utf8"), files["vault/Knowledge/references/book.md"]);
  assert.equal(await readFile(join(relocated, "assets/book/scan.txt"), "utf8"), "Synthetic source asset.");
});

test("reports missing external assets as non-portable dependencies", async t => {
  const root = await makeWorkspace(t, {
    ...files,
    "vault/Knowledge/references/external.md": note("Reference", "External book", "Not stored locally.", "resource: https://example.test/external\n"),
  });
  const result = await exportKnowledge(root, { format: "okf", destination: "exports/mixed" });
  assert.ok(result.manifest.externalDependencies.some(item => item.resource === "https://example.test/external"));
});

test("rejects destination inside the source bundle or overlapping its source", async t => {
  const root = await makeWorkspace(t, files);
  await assert.rejects(exportKnowledge(root, { format: "okf", destination: "vault/Knowledge/export" }), /destination|overlap|source/i);
  await assert.rejects(exportKnowledge(root, { format: "obsidian", destination: "vault" }), /destination|overlap|source/i);
});

test("rejects export traversal and symlink escapes before publishing output", async t => {
  const root = await makeWorkspace(t, files);
  const outside = await makeWorkspace(t, { "secret.txt": "secret" });
  await assert.rejects(exportKnowledge(root, { format: "okf", destination: "../../outside" }), /outside|workspace|destination/i);
  const link = join(root, "vault/Knowledge/assets/escape.txt");
  try { await symlink(join(outside, "secret.txt"), link, "file"); }
  catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) return t.skip(`symlink unavailable: ${error.code}`);
    throw error;
  }
  await assert.rejects(exportKnowledge(root, { format: "okf", destination: "exports/unsafe" }), /outside|workspace|symbolic/i);
  await assert.rejects(lstat(join(root, "exports/unsafe")), { code: "ENOENT" });
});

test("declares an unavailable source asset rather than fabricating a copy", async t => {
  const root = await makeWorkspace(t, {
    ...files,
    "vault/Knowledge/references/missing.md": note("Reference", "Missing asset", "External source.",
      "resource: https://example.test/missing\nconceptloom:\n  profile: conceptloom/1\n  uid: missing\n  access: full\n"),
  });
  const result = await exportKnowledge(root, { format: "okf", destination: "exports/partial" });
  assert.equal(result.manifest.assets.some(asset => asset.sourceUid === "missing" && asset.status === "missing"), true);
  assert.equal(result.diagnostics.some(item => item.severity === "warning"), true);
});

test("does not modify the source vault while exporting", async t => {
  const root = await makeWorkspace(t, files);
  const before = await readFile(join(root, "vault/Knowledge/concepts/vectors.md"), "utf8");
  await exportKnowledge(root, { format: "okf", destination: "exports/readonly" });
  assert.equal(await readFile(join(root, "vault/Knowledge/concepts/vectors.md"), "utf8"), before);
});
