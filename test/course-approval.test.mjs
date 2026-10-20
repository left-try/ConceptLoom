import test from "node:test";
import assert from "node:assert/strict";
import { approveRoadmap, proposeCourseEdit, setCoursePaused, draftSchedule, approveSchedule } from "../src/courses/approval.mjs";
import { getCourse } from "../src/courses/model.mjs";
import { createCourseDraft, createApprovedCourse, makeWorkspace } from "./helpers/courses.mjs";

const consent = digest => ({
  recordedAt: "2026-10-13T10:00:00.000Z",
  host: "codex",
  userResponse: "I approve the displayed plan.",
  shownDigest: digest,
});

test("approves only the exact roadmap revision that was shown", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createCourseDraft(root, { uid: "consent-roadmap" });
  const approved = await approveRoadmap(root, {
    courseUid: course.uid,
    roadmapRevision: course.roadmapRevision,
    consent: consent(course.roadmapRevision),
  });

  assert.equal(approved.status, "approved");
  assert.equal(approved.approvals.at(-1).roadmapRevision, course.roadmapRevision);
});

test("rejects stale consent after roadmap content changes", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createCourseDraft(root, { uid: "stale-consent" });
  await assert.rejects(approveRoadmap(root, {
    courseUid: course.uid,
    roadmapRevision: "old-roadmap-digest",
    consent: consent("old-roadmap-digest"),
  }));
  assert.deepEqual(await getCourse(root, { uid: course.uid }), course);
});

test("does not activate a schedule when only the roadmap was approved", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createApprovedCourse(root, { uid: "schedule-needs-consent" });
  const draft = await draftSchedule(root, {
    courseUid: course.uid,
    host: "codex",
    timezone: "Asia/Almaty",
    cadence: { kind: "weekly", weekdays: [1, 3, 5], interval: 1 },
    localTime: "09:00",
  });

  assert.equal(draft.status, "draft");
  assert.equal(draft.timezone, "Asia/Almaty");
  assert.equal(draft.localTime, "09:00");
  assert.equal(draft.missedRunPolicy, "resume-next");
  assert.equal(draft.progressionPolicy, "wait-for-learner");
  assert.equal((await getCourse(root, { uid: course.uid })).scheduleBinding, undefined);
});

test("schedule approval cannot replace roadmap approval", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createCourseDraft(root, { uid: "roadmap-approval-required" });
  const draft = await draftSchedule(root, {
    courseUid: course.uid,
    host: "codex",
    timezone: "Asia/Almaty",
    cadence: { kind: "daily", interval: 1 },
    localTime: "08:30",
  });
  await assert.rejects(approveSchedule(root, {
    courseUid: course.uid,
    draftId: draft.id,
    consent: consent(draft.digest),
  }));
});

test("requires separate consent for an exact schedule digest", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createApprovedCourse(root, { uid: "separate-consent" });
  const draft = await draftSchedule(root, {
    courseUid: course.uid,
    host: "codex",
    timezone: "Asia/Almaty",
    cadence: { kind: "daily", interval: 1 },
    localTime: "08:30",
  });
  await assert.rejects(approveSchedule(root, {
    courseUid: course.uid,
    draftId: draft.id,
    consent: consent(course.roadmapRevision),
  }));
  assert.equal((await getCourse(root, { uid: course.uid })).scheduleBinding, undefined);
});

test("rejects invalid IANA timezones and malformed local times", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createApprovedCourse(root, { uid: "invalid-schedule" });
  await assert.rejects(draftSchedule(root, {
    courseUid: course.uid,
    host: "codex",
    timezone: "Mars/Olympus",
    cadence: { kind: "daily", interval: 1 },
    localTime: "25:99",
  }));
});

test("requires renewed schedule consent after cadence changes", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createApprovedCourse(root, { uid: "changed-cadence" });
  const first = await draftSchedule(root, {
    courseUid: course.uid,
    host: "codex",
    timezone: "Asia/Almaty",
    cadence: { kind: "daily", interval: 1 },
    localTime: "08:30",
  });
  const changed = await draftSchedule(root, {
    courseUid: course.uid,
    host: "codex",
    timezone: "Asia/Almaty",
    cadence: { kind: "weekly", weekdays: [1], interval: 1 },
    localTime: "08:30",
  });
  assert.notEqual(changed.digest, first.digest);
  await assert.rejects(approveSchedule(root, {
    courseUid: course.uid,
    draftId: changed.id,
    consent: consent(first.digest),
  }));
});

test("keeps manually edited projection text and reports a hash conflict", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createCourseDraft(root, { uid: "projection-conflict" });
  await assert.rejects(proposeCourseEdit(root, {
    courseUid: course.uid,
    projectionHash: "stale-hash",
    proposal: { title: "Edited by learner", body: "Keep this personal explanation." },
  }));
  assert.deepEqual(await getCourse(root, { uid: course.uid }), course);
});

test("pause and resume preserve progression", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createApprovedCourse(root, { uid: "pause-course" });
  const before = structuredClone(course.progression);
  const paused = await setCoursePaused(root, {
    courseUid: course.uid,
    paused: true,
    expectedRevision: course.revision,
    reason: "Learner requested a break",
  });
  const resumed = await setCoursePaused(root, {
    courseUid: course.uid,
    paused: false,
    expectedRevision: paused.revision,
    reason: "Learner resumed",
  });

  assert.deepEqual(resumed.progression, before);
  assert.notEqual(resumed.status, "paused");
});

test("rejects unsupported cadence policies", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createApprovedCourse(root, { uid: "unsupported-cadence" });
  await assert.rejects(draftSchedule(root, {
    courseUid: course.uid,
    host: "codex",
    timezone: "UTC",
    cadence: { kind: "hourly", interval: 0 },
    localTime: "09:00",
  }));
});
