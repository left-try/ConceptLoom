import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createCourse, getCourse, patchCourse, updateLearnerProfile } from "../src/courses/model.mjs";
import { makeWorkspace, COURSE_UID } from "./helpers/courses.mjs";

const execFileAsync = promisify(execFile);

test("persists and restores a course after a fresh read", async t => {
  const root = await makeWorkspace(t);
  const created = await createCourse(root, {
    uid: COURSE_UID,
    topic: "Database transactions",
    goal: "Choose an isolation level for a small application",
    level: "intermediate",
    preferences: { language: "ru", minutesPerWeek: 90 },
  });

  const modelUrl = pathToFileURL(resolve("src/courses/model.mjs")).href;
  const childScript = `import { getCourse } from ${JSON.stringify(modelUrl)}; console.log(JSON.stringify(await getCourse(process.env.COURSE_ROOT, { uid: process.env.COURSE_UID })));`;
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", childScript], {
    cwd: process.cwd(),
    env: { ...process.env, COURSE_ROOT: root, COURSE_UID },
  });
  const restored = JSON.parse(stdout.trim());
  assert.equal(restored.uid, created.uid);
  assert.equal(restored.revision, created.revision);
  assert.equal(restored.goal, "Choose an isolation level for a small application");
  assert.equal(restored.preferences.language, "ru");
});

test("serializes concurrent updates that use the same expected revision", async t => {
  const root = await makeWorkspace(t);
  const course = await createCourse(root, { uid: COURSE_UID, topic: "Transactions", goal: "Choose isolation" });
  const results = await Promise.allSettled([
    patchCourse(root, { uid: COURSE_UID, expectedRevision: course.revision, patch: { goal: "Goal A" } }),
    patchCourse(root, { uid: COURSE_UID, expectedRevision: course.revision, patch: { goal: "Goal B" } }),
  ]);

  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected" && result.reason.code === "REVISION_CONFLICT").length, 1);
});

test("keeps progression separate for two courses that share a learner profile", async t => {
  const root = await makeWorkspace(t);
  const first = await createCourse(root, { uid: "transactions", topic: "Transactions", goal: "Choose isolation" });
  const second = await createCourse(root, { uid: "indexes", topic: "Indexes", goal: "Tune a query" });

  assert.deepEqual(first.progression, second.progression);
  const updated = await patchCourse(root, {
    uid: first.uid,
    expectedRevision: first.revision,
    patch: { diagnostic: { status: "in-progress", answers: [{ field: "experience", value: "used SQL" }] } },
  });
  const untouched = await getCourse(root, { uid: second.uid });
  assert.notDeepEqual(updated.diagnostic, untouched.diagnostic);
  assert.deepEqual(updated.progression, untouched.progression);
  assert.equal(untouched.diagnostic?.status, undefined);
});

test("requires the current revision and leaves state unchanged on stale update", async t => {
  const root = await makeWorkspace(t);
  const course = await createCourse(root, { uid: COURSE_UID, topic: "Transactions", goal: "Choose isolation" });
  const latest = await patchCourse(root, {
    uid: COURSE_UID,
    expectedRevision: course.revision,
    patch: { goal: "Choose an isolation level for an API" },
  });

  await assert.rejects(
    patchCourse(root, { uid: COURSE_UID, expectedRevision: course.revision, patch: { goal: "stale overwrite" } }),
    error => error.code === "REVISION_CONFLICT",
  );
  assert.deepEqual(await getCourse(root, { uid: COURSE_UID }), latest);
});

test("rejects generic patches that attempt to bypass domain transitions", async t => {
  const root = await makeWorkspace(t);
  const course = await createCourse(root, { uid: COURSE_UID, topic: "Transactions", goal: "Choose isolation" });

  for (const patch of [
    { status: "active" },
    { approvals: [{ roadmapRevision: "forged" }] },
    { scheduleBinding: { externalScheduleId: "forged" } },
    { progression: { completedLessonUids: ["lesson"] } },
  ]) {
    await assert.rejects(patchCourse(root, { uid: COURSE_UID, expectedRevision: course.revision, patch }));
  }
  assert.deepEqual(await getCourse(root, { uid: COURSE_UID }), course);
});

test("stores learner observations with their evidence basis", async t => {
  const root = await makeWorkspace(t);
  const profile = await updateLearnerProfile(root, {
    expectedRevision: 0,
    observations: [
      { field: "priorExperience", value: "used SQL at work", basis: "self-report", recordedAt: "2026-10-13T10:00:00Z" },
      { field: "language", value: "ru", basis: "preference", recordedAt: "2026-10-13T10:00:00Z" },
    ],
  });

  assert.equal(profile.observations[0].basis, "self-report");
  assert.equal(profile.observations[1].basis, "preference");
  assert.equal(profile.mastery?.priorExperience, undefined);
});

test("does not discard prior learner goals when adding observations", async t => {
  const root = await makeWorkspace(t);
  const first = await updateLearnerProfile(root, {
    expectedRevision: 0,
    observations: [{ field: "goal", value: "understand transactions", basis: "self-report", recordedAt: "2026-10-13T10:00:00Z" }],
  });
  const second = await updateLearnerProfile(root, {
    expectedRevision: first.revision,
    observations: [{ field: "language", value: "ru", basis: "preference", recordedAt: "2026-10-13T10:01:00Z" }],
  });

  assert.ok(second.observations.some(item => item.field === "goal"));
  assert.ok(second.observations.some(item => item.field === "language"));
});

test("rejects stale learner-profile revisions without dropping observations", async t => {
  const root = await makeWorkspace(t);
  const first = await updateLearnerProfile(root, {
    expectedRevision: 0,
    observations: [{ field: "goal", value: "learn", basis: "self-report", recordedAt: "2026-10-13T10:00:00Z" }],
  });
  await assert.rejects(updateLearnerProfile(root, {
    expectedRevision: 0,
    observations: [{ field: "language", value: "en", basis: "preference", recordedAt: "2026-10-13T10:01:00Z" }],
  }), error => error.code === "REVISION_CONFLICT");
  assert.deepEqual(await updateLearnerProfile(root, { expectedRevision: first.revision, observations: [] }), first);
});

test("validates required course fields before creating files", async t => {
  const root = await makeWorkspace(t);
  await assert.rejects(createCourse(root, { uid: "", topic: "", goal: "" }));
  await assert.rejects(getCourse(root, { uid: COURSE_UID }));
});
