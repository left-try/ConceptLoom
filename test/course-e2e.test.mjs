import test from "node:test";
import assert from "node:assert/strict";
import { bindNativeSchedule, prepareNativeSchedule } from "../src/hosts/scheduling.mjs";
import { claimLesson, completeLesson, publishLesson } from "../src/courses/dispatch.mjs";
import { getCourse } from "../src/courses/model.mjs";
import { createScheduleApprovedCourse, makeWorkspace, writeAssessmentReceipt } from "./helpers/courses.mjs";

test("runs the complete course path from research and consent through scheduled lesson evidence", async t => {
  const root = await makeWorkspace(t);
  const { course, scheduleApproval } = await createScheduleApprovedCourse(root, { uid: "whole-phase-e2e" });
  const capabilities = {
    host: "codex",
    questions: true,
    search: true,
    fetch: true,
    freshScheduledChat: true,
    mcpAppUi: false,
    localHtml: false,
    codingExecutor: false,
    durableWorkspace: true,
    workspaceRoot: root,
  };
  const prepared = await prepareNativeSchedule(root, {
    courseUid: course.uid,
    approvalId: scheduleApproval.id,
    capabilities,
  }, { verifyCapabilities: async () => true });
  assert.equal(prepared.action, "create-native-schedule");
  assert.equal((await getCourse(root, { uid: course.uid })).preparedSchedules[0].approvalId, scheduleApproval.id);

  const bound = await bindNativeSchedule(root, {
    courseUid: course.uid,
    approvalId: scheduleApproval.id,
    receipt: {
      host: "codex",
      nativeMethod: "scheduled-task",
      externalScheduleId: "e2e-schedule",
      executionScope: "local-workspace",
      timezone: "Asia/Almaty",
      startsFreshChat: true,
      workspaceRoot: root,
      createdAt: "2026-10-13T10:00:00Z",
    },
  }, { verifyReceipt: async () => true });
  assert.ok(bound.scheduleBinding);

  const claim = await claimLesson(root, {
    courseUid: course.uid,
    runId: "e2e-first-run",
    host: "codex",
    now: "2026-10-13T11:00:00Z",
  });
  assert.equal(claim.status, "claimed");
  const leaseId = claim.lease.leaseId ?? claim.lease.id;
  const publication = await publishLesson(root, {
    leaseId,
    runId: "e2e-first-run",
    hostChatId: "e2e-lesson-chat",
    now: "2026-10-13T11:01:00Z",
    artifact: {
      lessonUid: claim.capsule.lessonUid,
      title: "Choose an isolation level",
      body: "Explain the trade-off, show a worked example, then ask the learner to apply it.",
      promptDigest: claim.capsule.promptDigest,
      sourceHashes: claim.capsule.sourceBindings.map(binding => binding.contentHash),
    },
  });
  assert.equal(publication.status, "awaiting-learner");

  const duplicate = await claimLesson(root, {
    courseUid: course.uid,
    runId: "e2e-replay",
    host: "claude-code",
    now: "2026-10-13T11:01:00Z",
  });
  assert.notEqual(duplicate.status, "claimed");

  await writeAssessmentReceipt(root, {
    attemptId: "e2e-assessment",
    courseUid: course.uid,
    lessonUid: claim.capsule.lessonUid,
  });
  const current = await getCourse(root, { uid: course.uid });
  const completed = await completeLesson(root, {
    courseUid: course.uid,
    lessonUid: claim.capsule.lessonUid,
    expectedRevision: current.revision,
    evidenceAttemptIds: ["e2e-assessment"],
  });

  assert.equal(completed.status, "completed");
  assert.equal(completed.lessons[0].status, "completed");
});
