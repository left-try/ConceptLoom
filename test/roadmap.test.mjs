import test from "node:test";
import assert from "node:assert/strict";
import { proposeRoadmap, checkRoadmapReadiness } from "../src/courses/roadmap.mjs";
import { createCourse, getCourse } from "../src/courses/model.mjs";
import { createCourseDraft, makeWorkspace, lesson, sourceBinding, addTeachingSource, CONCEPT_UID } from "./helpers/courses.mjs";

test("creates a personalized roadmap from the learner goal and frontier", async t => {
  const root = await makeWorkspace(t);
  const { course, sources } = await createCourseDraft(root, { uid: "personal-roadmap" });
  assert.equal(course.goal, "Choose an isolation level for a small application");
  assert.equal(course.lessons[0].estimatedMinutes, 20);
  assert.equal(course.lessons[0].sourceBindings[0].sourceUid, sources[0].uid);
});

test("rejects duplicated lesson UIDs", async t => {
  const root = await makeWorkspace(t);
  const course = await createCourse(root, { uid: "duplicate-lessons", topic: "Transactions", goal: "Choose isolation" });
  await assert.rejects(proposeRoadmap(root, {
    courseUid: course.uid,
    expectedRevision: course.revision,
    lessons: [lesson({ uid: "same" }), lesson({ uid: "same" })],
  }));
});

test("blocks a cycle in lesson prerequisites", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createCourseDraft(root, { uid: "lesson-cycle" });
  const proposed = await proposeRoadmap(root, {
    courseUid: course.uid,
    expectedRevision: course.revision,
    lessons: [
      lesson({ uid: "one", prerequisiteLessonUids: ["two"] }),
      lesson({ uid: "two", prerequisiteLessonUids: ["one"] }),
    ],
  });

  assert.notEqual(proposed.readiness.ready, true);
  assert.ok(proposed.readiness.blockers.some(item => /cycle|prerequisite/i.test(`${item.code} ${item.message}`)));
});

test("blocks references to missing prerequisite lessons", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createCourseDraft(root, { uid: "missing-prerequisite" });
  const proposed = await proposeRoadmap(root, {
    courseUid: course.uid,
    expectedRevision: course.revision,
    lessons: [lesson({ uid: "one", prerequisiteLessonUids: ["does-not-exist"] })],
  });

  assert.notEqual(proposed.readiness.ready, true);
});

test("requires a usable teaching binding for every concept taught", async t => {
  const root = await makeWorkspace(t);
  const source = await addTeachingSource(root, { uid: "summary-source", coverage: "summary" });
  const { course } = await createCourseDraft(root, { uid: "summary-roadmap", sources: [source] });
  const readiness = await checkRoadmapReadiness(root, course);

  assert.notEqual(readiness.ready, true);
  assert.ok(readiness.blockers.some(item => item.conceptUid === CONCEPT_UID || /coverage|teaching/i.test(item.code)));
});

test("requires the exact source hash and a locator for teaching bindings", async t => {
  const root = await makeWorkspace(t);
  const { course, sources } = await createCourseDraft(root, { uid: "bad-binding" });
  const next = await proposeRoadmap(root, {
    courseUid: course.uid,
    expectedRevision: course.revision,
    lessons: [lesson({ sourceBindings: [sourceBinding(sources[0], {
      locator: { contentHash: "sha256:stale", value: "missing heading" },
    })] })],
  });

  assert.notEqual(next.readiness.ready, true);
});

test("blocks unknown concepts and locators absent from the imported source receipt", async t => {
  const root = await makeWorkspace(t);
  const { course, sources } = await createCourseDraft(root, { uid: "unknown-concept-locator" });
  const proposed = await proposeRoadmap(root, {
    courseUid: course.uid,
    expectedRevision: course.revision,
    lessons: [lesson({ conceptUids: ["not-in-knowledge"], sourceBindings: [sourceBinding(sources[0], { locator: { value: "missing heading" } })] })],
  });
  assert.notEqual(proposed.readiness.ready, true);
  assert.ok(proposed.readiness.blockers.some(item => item.code === "CONCEPT_NOT_FOUND"));
  assert.ok(proposed.readiness.blockers.some(item => item.code === "SOURCE_LOCATOR_NOT_FOUND"));
});

test("rejects malformed roadmap without changing the last saved course", async t => {
  const root = await makeWorkspace(t);
  const course = await createCourse(root, { uid: "roadmap-atomicity", topic: "Transactions", goal: "Choose isolation" });
  await assert.rejects(proposeRoadmap(root, {
    courseUid: course.uid,
    expectedRevision: course.revision,
    lessons: [{ uid: "", title: "", estimatedMinutes: -1 }],
  }));
  assert.deepEqual(await getCourse(root, { uid: course.uid }), course);
});

test("keeps the prior roadmap revision unchanged when a new draft is proposed", async t => {
  const root = await makeWorkspace(t);
  const { course, sources } = await createCourseDraft(root, { uid: "revision-history" });
  const firstRevision = course.roadmapRevision;
  const next = await proposeRoadmap(root, {
    courseUid: course.uid,
    expectedRevision: course.revision,
    lessons: [lesson({ title: "Revised: compare isolation levels", sourceBindings: [sourceBinding(sources[0])] })],
  });

  assert.notEqual(next.course.roadmapRevision, firstRevision);
});
