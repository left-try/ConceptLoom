import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { updateKnowledge } from "../src/knowledge/update.mjs";
import { exportKnowledge } from "../src/knowledge/export.mjs";
import { draftKnowledgeNote, acceptKnowledgeNote, buildStudyContext } from "../src/companion.mjs";
import { createCourse } from "../src/courses/model.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "loom-companion-")); const path = join(root, "vault", "Knowledge", "concepts", "note.md");
  await mkdir(join(path, ".."), { recursive: true }); const text = "---\ntype: Concept\ntitle: Note\nunknown: keep-me\n---\nUser body stays.\n"; await writeFile(path, text);
  return { root, text, path };
}

test("updates only one generated block and preserves note body", async () => {
  const { root, text, path } = await fixture();
  await updateKnowledge(root, { path: "concepts/note.md", expectedHash: hash(text), blockId: "related", generatedBody: "Generated relation." });
  const current = await readFile(path, "utf8");
  await updateKnowledge(root, { path: "concepts/note.md", expectedHash: hash(current), blockId: "related", generatedBody: "Revised relation." });
  const updated = await readFile(path, "utf8");
  assert.match(updated, /User body stays/); assert.match(updated, /unknown: keep-me/); assert.match(updated, /Revised relation/); assert.doesNotMatch(updated, /Generated relation/);
});

test("rejects a stale note hash without changing the file", async () => {
  const { root, text, path } = await fixture();
  await assert.rejects(updateKnowledge(root, { path: "concepts/note.md", expectedHash: "stale", blockId: "related", generatedBody: "replace" }), { code: "CONTENT_CONFLICT" });
  assert.equal(await readFile(path, "utf8"), text);
});

test("exports portable notes without personal data and rejects vault overlap", async () => {
  const { root } = await fixture(); await mkdir(join(root, "vault", "Knowledge", "Personal"), { recursive: true }); await writeFile(join(root, "vault", "Knowledge", "Personal", "private.md"), "private");
  const result = await exportKnowledge(root, { destination: "exports/vault" });
  assert.equal(result.manifest.personalNotesExcluded, true);
  await assert.rejects(readFile(join(root, "exports", "vault", "Personal", "private.md")), { code: "ENOENT" });
  await assert.rejects(exportKnowledge(root, { destination: "vault/Knowledge/export" }));
});

test("course-aware study context is bounded and reviewed note draft writes only after acceptance", async () => {
  const { root, text, path } = await fixture();
  const course = await createCourse(root, { uid: "active-course", topic: "Topics", goal: "Connect ideas" });
  const context = await buildStudyContext(root, { courseUid: course.uid, query: "note", maxChars: 1000 });
  assert.equal(context.context.course.uid, course.uid);
  const note = await draftKnowledgeNote({ title: "Connection", body: "This follows from the source.", basis: "learner-provided" });
  assert.equal(note.status, "draft-awaiting-learner-review");
  await assert.rejects(acceptKnowledgeNote(root, { path: "concepts/note.md", expectedHash: "wrong", blockId: "accepted", note }), { code: "CONTENT_CONFLICT" });
  await acceptKnowledgeNote(root, { path: "concepts/note.md", expectedHash: hash(text), blockId: "accepted", note });
  assert.match(await readFile(path, "utf8"), /Provenance: learner-provided/);
});
