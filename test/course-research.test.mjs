import test from "node:test";
import assert from "node:assert/strict";
import { recordCourseResearch } from "../src/courses/research.mjs";
import { createCourseDraft, makeWorkspace, addTeachingSource } from "./helpers/courses.mjs";

test("records research only when receipt resource and content hash match the imported source", async t => {
  const root = await makeWorkspace(t);
  const course = await (await import("../src/courses/model.mjs")).createCourse(root, {
    uid: "research-match", topic: "Transactions", goal: "Choose isolation",
  });
  const source = await addTeachingSource(root);
  const saved = await recordCourseResearch(root, {
    courseUid: course.uid,
    expectedRevision: course.revision,
    sourceUids: [source.uid],
    receipts: [{
      sourceUid: source.uid,
      canonicalResource: source.canonicalResource,
      contentHash: source.currentContentHash,
      coverage: source.coverage,
      receipt: source.receipt,
    }],
  });

  assert.ok(saved.sourceUids.includes(source.uid));
  assert.equal(saved.revision, course.revision + 1);
});

test("rejects a research receipt whose content hash differs from the source manifest", async t => {
  const root = await makeWorkspace(t);
  const course = await (await import("../src/courses/model.mjs")).createCourse(root, {
    uid: "research-hash-mismatch", topic: "Transactions", goal: "Choose isolation",
  });
  const source = await addTeachingSource(root);
  await assert.rejects(recordCourseResearch(root, {
    courseUid: course.uid,
    expectedRevision: course.revision,
    sourceUids: [source.uid],
    receipts: [{
      sourceUid: source.uid,
      canonicalResource: source.canonicalResource,
      contentHash: "sha256:wrong",
      coverage: "full",
      receipt: source.receipt,
    }],
  }));
});

test("rejects a research receipt for a different canonical resource", async t => {
  const root = await makeWorkspace(t);
  const course = await (await import("../src/courses/model.mjs")).createCourse(root, {
    uid: "research-resource-mismatch", topic: "Transactions", goal: "Choose isolation",
  });
  const source = await addTeachingSource(root);
  await assert.rejects(recordCourseResearch(root, {
    courseUid: course.uid,
    expectedRevision: course.revision,
    sourceUids: [source.uid],
    receipts: [{
      sourceUid: source.uid,
      canonicalResource: "https://example.test/other-page",
      contentHash: source.currentContentHash,
      coverage: "full",
      receipt: source.receipt,
    }],
  }));
});

test("does not treat metadata-only source access as teaching evidence", async t => {
  const root = await makeWorkspace(t);
  const { course, readiness } = await createCourseDraft(root, {
    uid: "metadata-only-course",
    sources: [await addTeachingSource(root, { uid: "metadata-only", coverage: "metadata", representation: "metadata" })],
  });

  assert.notEqual(readiness.ready, true);
  assert.equal(course.status, "roadmap-draft");
  assert.ok(readiness.blockers.length > 0);
});

test("uses a syllabus to inform the outline without treating it as lesson content", async t => {
  const root = await makeWorkspace(t);
  const { course, readiness } = await createCourseDraft(root, {
    uid: "syllabus-only-course",
    sources: [await addTeachingSource(root, { uid: "syllabus-only", coverage: "partial" })],
    sourceRoles: ["syllabus"],
  });

  assert.equal(course.status, "roadmap-draft");
  assert.notEqual(readiness.ready, true);
  assert.ok(readiness.blockers.some(item => /teaching|coverage|source/i.test(`${item.code} ${item.message}`)));
});

test("retains attribution for an external syllabus used to adapt a roadmap", async t => {
  const root = await makeWorkspace(t);
  const syllabus = await addTeachingSource(root, { uid: "external-syllabus", coverage: "partial" });
  const { course } = await createCourseDraft(root, {
    uid: "adapted-course",
    sources: [syllabus],
    sourceRoles: ["syllabus"],
    adaptedFrom: [{ sourceUid: syllabus.uid, contentHash: syllabus.currentContentHash, resource: syllabus.canonicalResource }],
  });

  assert.ok(course.sourceUids.includes(syllabus.uid));
  assert.ok(JSON.stringify(course).includes(syllabus.canonicalResource));
  assert.ok(course.roadmapRevision);
});

test("preserves uncertainty and conflicting-source diagnostics", async t => {
  const root = await makeWorkspace(t);
  const first = await addTeachingSource(root, { uid: "isolation-source-a", content: "Source A describes repeatable read." });
  const second = await addTeachingSource(root, {
    uid: "isolation-source-b",
    content: "Source B describes repeatable read differently.",
    limitations: ["Conflicting source statements require review."],
  });
  const { course, readiness } = await createCourseDraft(root, {
    uid: "conflicting-sources-course",
    sources: [first, second],
  });

  assert.ok(Array.isArray(readiness.diagnostics));
  assert.match(`${JSON.stringify(course)} ${JSON.stringify(readiness.diagnostics)}`, /Conflicting source statements|SOURCE_CONFLICT/);
});

test("does not change course state when research validation fails", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createCourseDraft(root, { uid: "research-atomicity" });
  const before = structuredClone(course);
  await assert.rejects(recordCourseResearch(root, {
    courseUid: course.uid,
    expectedRevision: course.revision,
    sourceUids: ["missing-source"],
    receipts: [],
  }));
  const restored = await (await import("../src/courses/model.mjs")).getCourse(root, { uid: course.uid });
  assert.deepEqual(restored, before);
});
