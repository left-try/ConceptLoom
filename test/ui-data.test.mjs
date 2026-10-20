import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildLearningView } from "../src/ui/views.mjs";
import { createExercise } from "../src/practice/model.mjs";
import { createCourse, updateCourseDomain } from "../src/courses/model.mjs";

test("local view escapes hostile labels and excludes private grading criteria", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-view-"));
  const conceptPath = join(root, "vault", "Knowledge", "concepts", "hostile.md"); await mkdir(join(conceptPath, ".."), { recursive: true });
  await writeFile(conceptPath, `---\ntype: Concept\ntitle: "<img src=x onerror=alert(1)>"\nconceptloom:\n  profile: conceptloom/1\n  uid: hostile\n---\nVisible note text.\n`);
  const course = await createCourse(root, { uid: "view-course", topic: "View", goal: "Inspect a graph" });
  const exercise = await createExercise(root, { uid: "private-exercise", courseUid: course.uid, lessonUid: "view-lesson", kind: "scenario", publicSpec: { task: "Choose safely.", prompt: "Which control bounds the work?", choices: [{ key: "limit", label: "Enforce a server-side limit" }, { key: "warning", label: "Show a client-side warning" }] }, privateCriteria: ["PRIVATE_RUBRIC_CANARY"] });
  await updateCourseDomain(root, { uid: course.uid, expectedRevision: course.revision, update: (current) => ({ ...current, lessons: [{ uid: "view-lesson", title: "View lesson", objectives: ["Inspect"], conceptUids: ["hostile"], sourceBindings: [], exerciseUids: [exercise.uid], estimatedMinutes: 5, status: "pending" }] }) });
  const result = await buildLearningView(root, { courseUid: course.uid, lessonUid: "view-lesson" });
  const html = await readFile(result.htmlPath, "utf8");
  assert.doesNotMatch(html, /PRIVATE_RUBRIC_CANARY|<img src/);
  assert.match(html, /Visible note text/);
  assert.match(html, /Text alternative/);
  assert.match(html, /graph-svg/);
  assert.match(html, /Record prediction/);
  assert.match(html, /Download attempt JSON/);
  assert.match(html, /Choose one answer/);
  assert.match(html, /Submit choice/);
  assert.match(html, /Enforce a server-side limit/);
  assert.match(html, /does not grade or save to course progress/);
});
