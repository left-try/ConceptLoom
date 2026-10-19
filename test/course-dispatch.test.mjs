import test from "node:test";
import assert from "node:assert/strict";
import { claimLesson, publishLesson, completeLesson } from "../src/courses/dispatch.mjs";
import { getCourse, updateLearnerProfile } from "../src/courses/model.mjs";
import { createApprovedCourse, makeWorkspace, writeAssessmentReceipt } from "./helpers/courses.mjs";

const artifact = {
  lessonUid: "isolation-levels",
  title: "Choose an isolation level",
  body: "A lesson with a worked example and a learner question.",
  promptDigest: "sha256:prompt-v1",
  sourceHashes: ["sha256:source-v1"],
};
const artifactFor = claim => ({ ...artifact, sourceHashes: claim.capsule.sourceBindings.map(binding => binding.contentHash) });

test("claims one eligible lesson and returns a resumable capsule", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createApprovedCourse(root, { uid: "dispatch-claim" });
  const claim = await claimLesson(root, {
    courseUid: course.uid,
    runId: "run-first",
    host: "codex",
    now: "2026-10-13T10:00:00.000Z",
  });

  assert.equal(claim.status, "claimed");
  assert.ok(claim.lease.leaseId ?? claim.lease.id);
  assert.equal(claim.capsule.courseUid, course.uid);
  assert.equal(claim.capsule.lessonUid, "isolation-levels");
  assert.equal(claim.capsule.promptDigest, "sha256:prompt-v1");
});

test("two hosts cannot hold active claims for the same lesson", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createApprovedCourse(root, { uid: "parallel-claims" });
  const [first, second] = await Promise.all([
    claimLesson(root, { courseUid: course.uid, runId: "codex-run", host: "codex", now: "2026-10-13T10:00:00Z" }),
    claimLesson(root, { courseUid: course.uid, runId: "claude-run", host: "claude-code", now: "2026-10-13T10:00:00Z" }),
  ]);

  assert.equal([first, second].filter(item => item.status === "claimed").length, 1);
  assert.ok([first, second].some(item => item.status === "no-op" || item.status === "blocked"));
});

test("replaying a committed publication returns the existing receipt", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createApprovedCourse(root, { uid: "publish-replay" });
  const claim = await claimLesson(root, { courseUid: course.uid, runId: "run-replay", host: "codex", now: "2026-10-13T10:00:00Z" });
  const leaseId = claim.lease.leaseId ?? claim.lease.id;
  const published = await publishLesson(root, {
    leaseId,
    runId: "run-replay",
    artifact: artifactFor(claim),
    hostChatId: "chat-123",
    now: "2026-10-13T10:01:00Z",
  });
  const replay = await publishLesson(root, {
    leaseId,
    runId: "run-replay",
    artifact: artifactFor(claim),
    hostChatId: "chat-123",
    now: "2026-10-13T10:01:00Z",
  });

  assert.deepEqual(replay, published);
  assert.equal(replay.hostChatId, "chat-123");
  assert.equal((await getCourse(root, { uid: course.uid })).lessons[0].status, "awaiting-learner");
});

test("parallel retries of the same run publish at most one lesson", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createApprovedCourse(root, { uid: "parallel-publication" });
  const claim = await claimLesson(root, { courseUid: course.uid, runId: "same-run", host: "codex", now: "2026-10-13T10:00:00Z" });
  const leaseId = claim.lease.leaseId ?? claim.lease.id;
  const input = { leaseId, runId: "same-run", artifact: artifactFor(claim), hostChatId: "one-chat", now: "2026-10-13T10:01:00Z" };
  const [first, retry] = await Promise.all([publishLesson(root, input), publishLesson(root, input)]);

  assert.deepEqual(first, retry);
  const restored = await getCourse(root, { uid: course.uid });
  assert.equal(restored.lessons.filter(item => item.status === "awaiting-learner").length, 1);
  assert.equal(restored.lessons.length, 1);
});

test("rejects reuse of a committed run ID with different publication content", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createApprovedCourse(root, { uid: "conflicting-publication" });
  const claim = await claimLesson(root, { courseUid: course.uid, runId: "stable-run", host: "codex", now: "2026-10-13T10:00:00Z" });
  const leaseId = claim.lease.leaseId ?? claim.lease.id;
  await publishLesson(root, { leaseId, runId: "stable-run", artifact: artifactFor(claim), hostChatId: "stable-chat", now: "2026-10-13T10:01:00Z" });
  await assert.rejects(publishLesson(root, {
    leaseId,
    runId: "stable-run",
    hostChatId: "different-chat",
    now: "2026-10-13T10:01:00Z",
    artifact: { ...artifactFor(claim), body: "Changed after the first publication." },
  }));
});

test("recovers an expired unpublished lease", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createApprovedCourse(root, { uid: "lease-expiry" });
  const first = await claimLesson(root, { courseUid: course.uid, runId: "run-expired", host: "codex", now: "2026-10-13T10:00:00Z" });
  const second = await claimLesson(root, { courseUid: course.uid, runId: "run-after-expiry", host: "claude-code", now: "2026-10-13T10:16:00Z" });

  assert.ok(first.lease.expiresAt);
  assert.equal(second.status, "claimed");
  assert.equal(second.lease.lessonUid, first.lease.lessonUid);
});

test("an expired claim cannot publish after a replacement claim starts", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createApprovedCourse(root, { uid: "expired-publish-denied" });
  const first = await claimLesson(root, { courseUid: course.uid, runId: "expired-old", host: "codex", now: "2026-10-13T10:00:00Z" });
  await claimLesson(root, { courseUid: course.uid, runId: "expired-new", host: "codex", now: "2026-10-13T10:16:00Z" });
  await assert.rejects(publishLesson(root, { leaseId: first.lease.id, runId: "expired-old", artifact: artifactFor(first), hostChatId: "late-chat", now: "2026-10-13T10:16:00Z" }), { code: "LEASE_INVALID" });
});

test("waits for learner input after a lesson is published", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createApprovedCourse(root, { uid: "awaits-learner" });
  const claim = await claimLesson(root, { courseUid: course.uid, runId: "run-await", host: "codex", now: "2026-10-13T10:00:00Z" });
  await publishLesson(root, { leaseId: claim.lease.leaseId ?? claim.lease.id, runId: "run-await", artifact: artifactFor(claim), hostChatId: "chat-await", now: "2026-10-13T10:01:00Z" });
  const next = await claimLesson(root, { courseUid: course.uid, runId: "run-next", host: "codex", now: "2026-10-13T10:01:00Z" });

  assert.ok(["blocked", "no-op"].includes(next.status));
  assert.equal((await getCourse(root, { uid: course.uid })).lessons[0].status, "awaiting-learner");
});

test("does not claim lessons while the course is paused", async t => {
  const root = await makeWorkspace(t);
  let { course } = await createApprovedCourse(root, { uid: "paused-dispatch" });
  const { setCoursePaused } = await import("../src/courses/approval.mjs");
  course = await setCoursePaused(root, { courseUid: course.uid, paused: true, expectedRevision: course.revision, reason: "pause" });
  const result = await claimLesson(root, { courseUid: course.uid, runId: "run-paused", host: "codex", now: "2026-10-13T10:00:00Z" });

  assert.equal(result.status, "no-op");
});

test("returns no-op for completed courses", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createApprovedCourse(root, { uid: "completed-dispatch" });
  const claim = await claimLesson(root, { courseUid: course.uid, runId: "run-final-lesson", host: "codex", now: "2026-10-13T10:00:00Z" });
  const leaseId = claim.lease.leaseId ?? claim.lease.id;
  await publishLesson(root, { leaseId, runId: "run-final-lesson", artifact: artifactFor(claim), hostChatId: "chat-final", now: "2026-10-13T10:01:00Z" });
  await writeAssessmentReceipt(root, { attemptId: "attempt-final", courseUid: course.uid, lessonUid: "isolation-levels" });
  const current = await getCourse(root, { uid: course.uid });
  const completed = await completeLesson(root, {
    courseUid: course.uid,
    lessonUid: "isolation-levels",
    expectedRevision: current.revision,
    evidenceAttemptIds: ["attempt-final"],
  });
  assert.equal(completed.status, "completed");
  const result = await claimLesson(root, { courseUid: course.uid, runId: "run-after-completion", host: "codex", now: "2026-10-13T10:05:00Z" });
  assert.equal(result.status, "no-op");
});

test("requires persisted assessment evidence before completing a lesson", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createApprovedCourse(root, { uid: "completion-evidence" });
  await assert.rejects(completeLesson(root, {
    courseUid: course.uid,
    lessonUid: "isolation-levels",
    expectedRevision: course.revision,
    evidenceAttemptIds: [],
  }));
});

test("completes only with existing evidence attempts", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createApprovedCourse(root, { uid: "completion-valid-evidence" });
  await assert.rejects(completeLesson(root, {
    courseUid: course.uid,
    lessonUid: "isolation-levels",
    expectedRevision: course.revision,
    evidenceAttemptIds: ["missing-attempt"],
  }));
});

test("bounds resume capsules while keeping current action and identifiers", async t => {
  const root = await makeWorkspace(t);
  await updateLearnerProfile(root, {
    expectedRevision: 0,
    observations: [{
      field: "learningContext",
      value: "x".repeat(20_000),
      basis: "self-report",
      recordedAt: "2026-10-13T09:00:00Z",
    }],
  });
  const { course } = await createApprovedCourse(root, { uid: "capsule-bound" });
  const claim = await claimLesson(root, {
    courseUid: course.uid,
    runId: "run-capsule",
    host: "codex",
    now: "2026-10-13T10:00:00Z",
  });

  assert.ok(JSON.stringify(claim.capsule).length <= 16_000);
  assert.equal(claim.capsule.courseUid, course.uid);
  assert.ok(claim.capsule.lessonUid);
  assert.ok(claim.capsule.nextStep);
  assert.ok((claim.diagnostics ?? claim.capsule.diagnostics)?.length);
});
