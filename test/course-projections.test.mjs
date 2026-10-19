import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createCourseDraft, makeWorkspace } from "./helpers/courses.mjs";
import { exportCourseProjection, importCourseProjectionEdit } from "../src/courses/projections.mjs";
import { getCourse } from "../src/courses/model.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");

test("exports a generated course block while preserving manually maintained Knowledge text", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createCourseDraft(root, { uid: "course-projection-export" });
  const path = "concepts/transaction-isolation.md";
  const file = join(root, "vault", "Knowledge", path);
  await writeFile(file, `${await readFile(file, "utf8")}Manual note kept outside the generated course block.\n`, "utf8");
  const before = await readFile(file);
  const result = await exportCourseProjection(root, { courseUid: course.uid, path, expectedHash: hash(before) });
  const after = await readFile(file, "utf8");
  assert.equal(result.hash, hash(Buffer.from(after)));
  assert.match(after, /Manual note kept outside the generated course block/);
  assert.match(after, /conceptloom:generated:course-course-projection-export:start/);
  assert.match(after, /Choose an isolation level/);
});

test("imports a Knowledge edit as a proposal without changing the approved course roadmap", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createCourseDraft(root, { uid: "course-projection-import" });
  const path = "concepts/transaction-isolation.md";
  const file = join(root, "vault", "Knowledge", path);
  const starting = await readFile(file, "utf8");
  await exportCourseProjection(root, { courseUid: course.uid, path, expectedHash: hash(Buffer.from(starting)) });
  const edited = `${await readFile(file, "utf8")}Learner's proposed addition.\n`;
  await writeFile(file, edited, "utf8");
  const updated = await importCourseProjectionEdit(root, { courseUid: course.uid, path, expectedHash: hash(Buffer.from(edited)) });
  assert.equal(updated.roadmapRevision, course.roadmapRevision);
  assert.equal(updated.lessons[0].title, course.lessons[0].title);
  assert.match(updated.editProposals.at(-1).proposal.noteContent, /Learner's proposed addition/);
});

test("rejects stale Knowledge projection hashes", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createCourseDraft(root, { uid: "course-projection-conflict" });
  const path = "concepts/transaction-isolation.md";
  const file = join(root, "vault", "Knowledge", path);
  await exportCourseProjection(root, { courseUid: course.uid, path, expectedHash: hash(await readFile(file)) });
  await assert.rejects(exportCourseProjection(root, { courseUid: course.uid, path, expectedHash: "stale" }), { code: "PROJECTION_HASH_CONFLICT" });
  await writeFile(file, `${await readFile(file, "utf8")}concurrent edit\n`, "utf8");
  const content = await readFile(file, "utf8");
  await assert.rejects(importCourseProjectionEdit(root, { courseUid: course.uid, path, expectedHash: hash(Buffer.from(content.slice(0, -1))) }), { code: "PROJECTION_HASH_CONFLICT" });
  assert.equal((await getCourse(root, { uid: course.uid })).editProposals?.length ?? 0, 0);
});
