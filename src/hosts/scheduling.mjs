import { getCourse } from "../courses/model.mjs";
import { claimLesson, publishLesson } from "../courses/dispatch.mjs";
import { validateCapabilities } from "./capabilities.mjs";
import { courseError, readJson } from "../courses/state.mjs";

export { validateCapabilities };
export async function prepareNativeSchedule(root, { courseUid, approvalId, capabilities }, { verifyCapabilities } = {}) {
  let course;
  try { course = await getCourse(root, { uid: courseUid }); }
  catch { throw courseError("COURSE_NOT_FOUND", `course ${courseUid} not found`); }
  let report;
  try { report = validateCapabilities(capabilities); }
  catch (error) { throw courseError("CAPABILITY_UNAVAILABLE", error.message); }
  const approval = (course.scheduleApprovals ?? []).find(item => item.id === approvalId && item.status === "approved");
  if (!approval) throw courseError("SCHEDULE_APPROVAL_REQUIRED", "approved schedule consent is required");
  const draft = course.scheduleDrafts.find(item => item.id === approval.draftId);
  if (approval.roadmapRevision !== course.roadmapRevision || draft?.roadmapRevision !== course.roadmapRevision) throw courseError("STALE_SCHEDULE_APPROVAL", "schedule consent was granted for a superseded roadmap");
  const hasTrustedVerifier = typeof verifyCapabilities === "function";
  const verified = hasTrustedVerifier && await verifyCapabilities(report, { courseUid, approvalId, workspaceRoot: root }) === true;
  const supported = verified && report.host === draft.host && report.freshScheduledChat && report.durableWorkspace && report.workspaceRoot === root;
  const lessonLaunchPrompt = `Open the ConceptLoom workspace at ${root}. For course ${course.uid}, call loom_claim_lesson with the run ID and host. If claimed, start a fresh lesson chat using the returned capsule. Never skip a lesson after a missed run; wait for learner evidence before the next lesson.`;
  if (!supported) {
    const diagnostics = [];
    if (!hasTrustedVerifier) diagnostics.push({ code: "HOST_ADAPTER_UNAVAILABLE", message: `No trusted ${draft.host} scheduler adapter is connected to verify native scheduling; the schedule is not active.` });
    else if (!verified) diagnostics.push({ code: "CAPABILITY_UNVERIFIED", message: "The host adapter did not verify the reported scheduling capabilities; the schedule is not active." });
    if (report.host !== draft.host) diagnostics.push({ code: "SCHEDULE_HOST_MISMATCH", message: "The observed host differs from the host approved in the schedule draft." });
    if (!report.freshScheduledChat) diagnostics.push({ code: "FRESH_CHAT_UNAVAILABLE", message: "The host cannot confirm that scheduled lessons start in a fresh chat." });
    if (!report.durableWorkspace || report.workspaceRoot !== root) diagnostics.push({ code: "DURABLE_WORKSPACE_UNAVAILABLE", message: "The host cannot confirm durable access to this exact course workspace." });
    return { action: "manual-setup", lessonLaunchPrompt, diagnostics };
  }
  const intent = { approvalId, draftId: draft.id, capabilityReport: report, preparedAt: new Date().toISOString(), status: "prepared" };
  if (!(course.preparedSchedules ?? []).some(item => item.approvalId === approvalId && item.status === "prepared")) await (await import("../courses/state.mjs")).updateCourse(root, courseUid, course.revision, current => ({ ...current, preparedSchedules: [...(current.preparedSchedules ?? []), intent] }));
  return { action: "create-native-schedule", lessonLaunchPrompt, draft, approval, intent };
}
export async function bindNativeSchedule(root, { courseUid, approvalId, receipt } = {}, { verifyReceipt } = {}) {
  const course = await getCourse(root, { uid: courseUid });
  if (course.scheduleBinding?.status === "active" && course.scheduleBinding.approvalId === approvalId && JSON.stringify(course.scheduleBinding.receipt) === JSON.stringify(receipt)) return course;
  if (course.scheduleBinding?.status === "active") throw courseError("SCHEDULER_ALREADY_BOUND", "only one active native schedule is allowed per course");
  const approval = (course.scheduleApprovals ?? []).find(item => item.id === approvalId && item.status === "approved");
  if (!approval) throw courseError("SCHEDULE_APPROVAL_REQUIRED", "approved schedule consent is required");
  if (approval.roadmapRevision !== course.roadmapRevision) throw courseError("STALE_SCHEDULE_APPROVAL", "schedule consent was granted for a superseded roadmap");
  const draft = course.scheduleDrafts.find(item => item.id === approval.draftId);
  if (draft.roadmapRevision !== course.roadmapRevision) throw courseError("STALE_SCHEDULE_DRAFT", "schedule draft was created for a superseded roadmap");
  if (!receipt || receipt.host !== draft.host || !receipt.nativeMethod || !receipt.externalScheduleId || !receipt.executionScope || receipt.timezone !== draft.timezone || receipt.startsFreshChat !== true || receipt.workspaceRoot !== root || !receipt.createdAt || !Number.isFinite(Date.parse(receipt.createdAt))) throw courseError("INVALID_NATIVE_RECEIPT", "confirmed native receipt must match host, timezone, fresh chat and approved workspace");
  if (typeof verifyReceipt !== "function" || await verifyReceipt(receipt, { courseUid, approvalId, draft, workspaceRoot: root }) !== true) throw courseError("NATIVE_RECEIPT_UNVERIFIED", "an installed host adapter must verify the native schedule before it can become active");
  const binding = { status: "active", approvalId, draftId: draft.id, receipt: structuredClone(receipt), createdAt: receipt.createdAt };
  return (await import("../courses/state.mjs")).updateCourse(root, courseUid, course.revision, current => ({ ...current, scheduleBinding: binding }));
}
export async function reconcileNativePublication(root, { runId, hostChatId, outcome } = {}) {
  const { withWorkspaceLock } = await import("../storage/transactions.mjs");
  return withWorkspaceLock(root, async () => {
    const state = await readJson(root, ".concept-loom/courses/dispatch.json");
    const lease = Object.values(state.leases ?? {}).find(item => item.runId === runId);
    if (!lease) throw courseError("RUN_NOT_FOUND", `run ${runId} was not claimed`);
    if (outcome === "missed") { const previousRevision = state.revision; lease.status = "missed"; state.revision++; await (await import("../courses/dispatch.mjs")).persistDispatch(root, state, previousRevision); return { status: "no-op", runId }; }
    if (outcome === "unknown" || !hostChatId) { const previousRevision = state.revision; lease.status = "publication-unknown"; state.revision++; await (await import("../courses/dispatch.mjs")).persistDispatch(root, state, previousRevision); return { status: "publication-unknown", runId, courseUid: lease.courseUid, lessonUid: lease.lessonUid }; }
    if (outcome !== "published") throw courseError("INVALID_RECONCILIATION", "outcome must be missed, unknown or published");
    const course = await getCourse(root, { uid: lease.courseUid });
    const lesson = course.lessons.find(item => item.uid === lease.lessonUid);
    return (await import("../courses/dispatch.mjs")).publishLesson(root, { leaseId: lease.id, runId, hostChatId, confirmedReconciliation: true, artifact: { lessonUid: lease.lessonUid, title: "Published course lesson", body: "Host confirmed publication; continue this existing lesson chat.", promptDigest: "sha256:reconciled", sourceHashes: (lesson?.sourceBindings ?? []).filter(binding => binding.role === "teaching").map(binding => binding.contentHash) } });
  });
}
