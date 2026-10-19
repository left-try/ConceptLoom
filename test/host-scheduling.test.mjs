import test from "node:test";
import assert from "node:assert/strict";
import { validateCapabilities, prepareNativeSchedule, bindNativeSchedule, reconcileNativePublication } from "../src/hosts/scheduling.mjs";
import { getCourse } from "../src/courses/model.mjs";
import { createScheduleApprovedCourse, makeWorkspace } from "./helpers/courses.mjs";

const capabilities = overrides => ({
  host: "codex",
  questions: true,
  search: true,
  fetch: true,
  freshScheduledChat: true,
  mcpAppUi: false,
  localHtml: true,
  codingExecutor: false,
  durableWorkspace: true,
  workspaceRoot: "C:/learning",
  ...overrides,
});

const nativeReceipt = overrides => ({
  host: "codex",
  nativeMethod: "scheduled-task",
  externalScheduleId: "schedule-123",
  executionScope: "local-workspace",
  timezone: "Asia/Almaty",
  startsFreshChat: true,
  workspaceRoot: "C:/learning",
  createdAt: "2026-10-13T10:00:00Z",
  ...overrides,
});

test("validates capabilities from an observed host report", () => {
  const checked = validateCapabilities(capabilities({}));
  assert.equal(checked.host, "codex");
  assert.equal(checked.freshScheduledChat, true);
  assert.equal(checked.durableWorkspace, true);
});

test("rejects capabilities that claim scheduling without durable workspace access", async t => {
  const root = await makeWorkspace(t);
  const { course, scheduleApproval } = await createScheduleApprovedCourse(root, { uid: "no-durable-workspace" });
  const result = await prepareNativeSchedule(root, {
    courseUid: course.uid,
    approvalId: scheduleApproval.id,
    capabilities: capabilities({ durableWorkspace: false, workspaceRoot: undefined }),
  });

  assert.notEqual(result.action, "create-native-schedule");
  assert.match(result.lessonLaunchPrompt, /workspace|storage/i);
  assert.equal((await getCourse(root, { uid: course.uid })).preparedSchedules?.length ?? 0, 0);
});

test("returns actionable setup instructions when the host lacks scheduled fresh chats", async t => {
  const root = await makeWorkspace(t);
  const { course, scheduleApproval } = await createScheduleApprovedCourse(root, { uid: "unsupported-host" });
  const result = await prepareNativeSchedule(root, {
    courseUid: course.uid,
    approvalId: scheduleApproval.id,
    capabilities: capabilities({ freshScheduledChat: false }),
  });

  assert.notEqual(result.action, "create-native-schedule");
  assert.ok(result.lessonLaunchPrompt.length > 0);
});

test("does not bind a native schedule without a confirmed receipt", async t => {
  const root = await makeWorkspace(t);
  const { course, scheduleApproval } = await createScheduleApprovedCourse(root, { uid: "unconfirmed-receipt" });
  await assert.rejects(bindNativeSchedule(root, {
    courseUid: course.uid,
    approvalId: scheduleApproval.id,
    receipt: { ...nativeReceipt(), externalScheduleId: undefined, workspaceRoot: root },
  }));
  assert.equal((await getCourse(root, { uid: course.uid })).scheduleBinding, undefined);
});

test("does not activate caller supplied capability claims without a trusted adapter", async t => {
  const root = await makeWorkspace(t);
  const { course, scheduleApproval } = await createScheduleApprovedCourse(root, { uid: "unverified-capabilities" });
  const result = await prepareNativeSchedule(root, { courseUid: course.uid, approvalId: scheduleApproval.id, capabilities: capabilities({ workspaceRoot: root }) });
  assert.equal(result.action, "manual-setup");
  assert.equal((await getCourse(root, { uid: course.uid })).preparedSchedules?.length ?? 0, 0);
});

test("does not activate a caller supplied schedule receipt without host verification", async t => {
  const root = await makeWorkspace(t);
  const { course, scheduleApproval } = await createScheduleApprovedCourse(root, { uid: "unverified-receipt" });
  await assert.rejects(bindNativeSchedule(root, { courseUid: course.uid, approvalId: scheduleApproval.id, receipt: nativeReceipt({ workspaceRoot: root }) }), { code: "NATIVE_RECEIPT_UNVERIFIED" });
});

test("requires receipt timezone and workspace to match the approved draft", async t => {
  const root = await makeWorkspace(t);
  const { course, scheduleApproval } = await createScheduleApprovedCourse(root, { uid: "receipt-mismatch" });
  await assert.rejects(bindNativeSchedule(root, {
    courseUid: course.uid,
    approvalId: scheduleApproval.id,
    receipt: nativeReceipt({ timezone: "UTC", workspaceRoot: "C:/other" }),
  }));
});

test("allows only one active scheduler binding per course across hosts", async t => {
  const root = await makeWorkspace(t);
  const { course, scheduleApproval } = await createScheduleApprovedCourse(root, { uid: "one-scheduler" });
  await bindNativeSchedule(root, {
    courseUid: course.uid,
    approvalId: scheduleApproval.id,
    receipt: nativeReceipt({ workspaceRoot: root }),
  }, { verifyReceipt: async () => true });
  const { draftSchedule, approveSchedule } = await import("../src/courses/approval.mjs");
  const secondDraft = await draftSchedule(root, {
    courseUid: course.uid,
    host: "claude-code",
    timezone: "Asia/Almaty",
    cadence: { kind: "weekly", weekdays: [2, 4], interval: 1 },
    localTime: "10:00",
  });
  const secondApproval = await approveSchedule(root, {
    courseUid: course.uid,
    draftId: secondDraft.id,
    consent: {
      recordedAt: "2026-10-13T10:10:00Z",
      host: "claude-code",
      userResponse: "Approve the second schedule draft.",
      shownDigest: secondDraft.digest,
    },
  });
  await assert.rejects(bindNativeSchedule(root, {
    courseUid: course.uid,
    approvalId: secondApproval.id,
    receipt: nativeReceipt({ host: "claude-code", externalScheduleId: "schedule-456", nativeMethod: "claude-task", workspaceRoot: root }),
  }, { verifyReceipt: async () => true }));
});

test("reuses the existing binding for a replay of the same schedule receipt", async t => {
  const root = await makeWorkspace(t);
  const { course, scheduleApproval } = await createScheduleApprovedCourse(root, { uid: "schedule-replay" });
  const input = { courseUid: course.uid, approvalId: scheduleApproval.id, receipt: nativeReceipt({ workspaceRoot: root }) };
  const first = await bindNativeSchedule(root, input, { verifyReceipt: async () => true });
  const replay = await bindNativeSchedule(root, input, { verifyReceipt: async () => true });
  assert.deepEqual(replay, first);
});

test("does not skip lessons after a missed scheduled run", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createScheduleApprovedCourse(root, { uid: "missed-run" });
  await (await import("../src/courses/dispatch.mjs")).claimLesson(root, {
    courseUid: course.uid,
    runId: "missed-run-1",
    host: "codex",
    now: "2026-10-13T08:00:00Z",
  });
  const result = await reconcileNativePublication(root, {
    runId: "missed-run-1",
    hostChatId: undefined,
    outcome: "missed",
  });

  assert.equal(result.status, "no-op");
  assert.equal((await getCourse(root, { uid: course.uid })).progression.currentLessonUid, undefined);
});

test("marks ambiguous host publication for reconciliation without retrying", async t => {
  const root = await makeWorkspace(t);
  const { course } = await createScheduleApprovedCourse(root, { uid: "unknown-native-run" });
  await (await import("../src/courses/dispatch.mjs")).claimLesson(root, {
    courseUid: course.uid,
    runId: "unknown-native-run",
    host: "codex",
    now: "2026-10-13T08:00:00Z",
  });
  const result = await reconcileNativePublication(root, {
    runId: "unknown-native-run",
    hostChatId: undefined,
    outcome: "unknown",
  });
  assert.equal(result.status, "publication-unknown");
  const retry = await (await import("../src/courses/dispatch.mjs")).claimLesson(root, { courseUid: course.uid, runId: "later-run", host: "codex", now: "2026-10-13T08:30:00Z" });
  assert.equal(retry.reason, "publication-unknown");
  const confirmed = await reconcileNativePublication(root, { runId: "unknown-native-run", hostChatId: "existing-chat", outcome: "published" });
  assert.equal(confirmed.status, "awaiting-learner");
  assert.equal((await getCourse(root, { uid: course.uid })).lessons[0].status, "awaiting-learner");
});

test("rejects schedule binding for consent tied to a superseded roadmap", async t => {
  const root = await makeWorkspace(t);
  const { course, scheduleApproval } = await createScheduleApprovedCourse(root, { uid: "stale-schedule-consent" });
  const { proposeRoadmap } = await import("../src/courses/roadmap.mjs");
  const latest = await getCourse(root, { uid: course.uid });
  await proposeRoadmap(root, { courseUid: course.uid, expectedRevision: latest.revision, lessons: [{ uid: "changed-lesson", title: "Changed lesson", objectives: ["new"], conceptUids: ["transaction-isolation"], sourceBindings: course.lessons[0].sourceBindings, estimatedMinutes: 15 }] });
  await assert.rejects(bindNativeSchedule(root, { courseUid: course.uid, approvalId: scheduleApproval.id, receipt: nativeReceipt({ workspaceRoot: root }) }, { verifyReceipt: async () => true }), { code: "STALE_SCHEDULE_APPROVAL" });
});

test("rejects malformed or contradictory host capability reports", () => {
  assert.throws(() => validateCapabilities({ host: "codex", freshScheduledChat: true }));
  assert.throws(() => validateCapabilities(capabilities({ host: "unknown-host" })));
});
