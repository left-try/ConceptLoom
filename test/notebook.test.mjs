import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beginNotebook, addNotebookEntry, resolveNotebookPath } from "../src/notebook.mjs";

test("creates and extends a notebook", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-test-"));
  await beginNotebook(root, { path: "notes/session.md", title: "Vectors" });
  await addNotebookEntry(root, { path: "notes/session.md", kind: "insight", body: "Direction and magnitude belong together." });
  const text = await readFile(join(root, "notes/session.md"), "utf8");
  assert.match(text, /# Vectors/);
  assert.match(text, /KEY CONNECTION/);
});

test("reuses the absolute path returned when starting a notebook", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-roundtrip-"));
  const path = await beginNotebook(root, { path: "notes/session.md", title: "Vectors" });
  await addNotebookEntry(root, { path, kind: "insight", body: "The returned path is reusable." });
  assert.match(await readFile(path, "utf8"), /returned path is reusable/);
});

test("accepts a legacy absolute notebook path contained by the workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-legacy-notebook-"));
  const legacyPath = await beginNotebook(root, { path: "notes/session.md", title: "Vectors" });
  await addNotebookEntry(root, { path: legacyPath, kind: "learner", body: "Legacy absolute paths remain contained." });
  assert.match(await readFile(legacyPath, "utf8"), /Legacy absolute paths remain contained/);
});

test("rejects notebook paths outside the workspace", () => {
  assert.throws(() => resolveNotebookPath("/tmp/work", "../outside.md"), /inside the working directory/);
});
