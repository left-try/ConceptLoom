import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getCourse, updateCourseDomain } from "../courses/model.mjs";

const HOSTS = new Set(["codex", "claude-code", "chatgpt"]);
const BOOLEAN_FIELDS = ["questions", "search", "fetch", "freshScheduledChat", "mcpAppUi", "localHtml", "codingExecutor", "durableWorkspace"];

export function validateCapabilities(report) {
  const unavailable = (message) => Object.assign(new Error(message), { code: "CAPABILITY_UNAVAILABLE" });
  if (!report || !HOSTS.has(report.host)) throw unavailable("host capability report has an unsupported host");
  for (const field of BOOLEAN_FIELDS) if (typeof report[field] !== "boolean") throw unavailable(`capability report must include boolean '${field}'`);
  if (report.durableWorkspace && (typeof report.workspaceRoot !== "string" || !report.workspaceRoot.trim())) throw unavailable("durable workspace capability requires workspaceRoot");
  return structuredClone(report);
}

export async function prepareNativeSchedule(root, { courseUid, approvalId, capabilities: raw }) {
  const course = await getCourse(root, { uid: courseUid });
  const capabilities = validateCapabilities(raw);
  const approval = (course.scheduleApprovals ?? []).find((item) => item.id === approvalId);
  if (!approval) throw new Error("approved schedule draft was not found");
  const schedule = approval.schedule;
  const supported = capabilities.freshScheduledChat && capabilities.durableWorkspace && capabilities.workspaceRoot === root && capabilities.host === schedule.host;
  if (!supported) {
    return {
      action: "manual-setup-required",
      lessonLaunchPrompt: `Configure ${schedule.host} to run at ${schedule.localTime} (${schedule.timezone}) in workspace ${root}. Each run must open a fresh lesson chat, load course ${course.uid}, resume one eligible lesson, and wait for the learner before advancing.`,
    };
  }
  const lessonLaunchPrompt = `Concept Loom scheduled course ${course.uid}. Workspace: ${root}. Run idempotently: inspect course state, do not advance past an unfinished lesson, resume one eligible lesson in a fresh chat, show the saved lesson and ask the learner to respond. Missed runs resume the next eligible lesson; do not catch up by skipping. If publication status is ambiguous, stop and reconcile before creating another chat.`;
  return { action: "create-native-schedule", lessonLaunchPrompt, schedule, approvalId };
}

export async function bindNativeSchedule(root, { courseUid, approvalId, receipt }) {
  const course = await getCourse(root, { uid: courseUid });
  const approval = (course.scheduleApprovals ?? []).find((item) => item.id === approvalId);
  if (!approval) throw new Error("schedule approval was not found");
  if (course.scheduleBinding) {
    const existing = course.scheduleBinding;
    if (existing.approvalId === approvalId && existing.receipt?.externalScheduleId === receipt?.externalScheduleId) return course;
    throw new Error("course already has an active native scheduler binding");
  }
  const schedule = approval.schedule;
  if (!receipt || !receipt.host || !receipt.nativeMethod || !receipt.externalScheduleId || !receipt.executionScope || !receipt.timezone || !receipt.workspaceRoot || !receipt.createdAt) throw new Error("native schedule receipt is incomplete or unconfirmed");
  if (receipt.host !== schedule.host || receipt.timezone !== schedule.timezone || receipt.workspaceRoot !== root || receipt.startsFreshChat !== true) throw new Error("native receipt does not match the approved host, timezone, workspace, and fresh-chat behavior");
  const updated = await updateCourseDomain(root, {
    uid: courseUid, expectedRevision: course.revision,
    update: (current) => ({ ...current, status: "active", scheduleBinding: { approvalId, digest: approval.digest, receipt: structuredClone(receipt), boundAt: new Date().toISOString() } }),
  });
  return updated;
}

async function courses(root) {
  const directory = join(root, ".concept-loom", "courses");
  let names;
  try { names = await readdir(directory); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const result = [];
  for (const name of names.filter((item) => item.endsWith(".json"))) result.push(JSON.parse(await readFile(join(directory, name), "utf8")));
  return result;
}

export async function reconcileNativePublication(root, { runId, hostChatId, outcome }) {
  const course = (await courses(root)).find((item) => item.dispatch?.lease?.runId === runId);
  if (!course) return { status: "no-op", runId };
  if (outcome === "missed") return { status: "no-op", runId, courseUid: course.uid, reason: "scheduled run was missed; lesson remains eligible" };
  if (outcome !== "unknown") throw new Error("outcome must be missed or unknown");
  const lease = course.dispatch.lease;
  const receipt = { status: "publication-unknown", runId, courseUid: course.uid, lessonUid: lease.lessonUid, hostChatId, reason: "host publication result is ambiguous; reconcile before retrying" };
  await updateCourseDomain(root, {
    uid: course.uid, expectedRevision: course.revision,
    update: (current) => ({ ...current, dispatch: { ...current.dispatch, lease: { ...current.dispatch.lease, status: "publication-unknown" }, publications: { ...(current.dispatch.publications ?? {}), [runId]: { contentHash: null, receipt } } } }),
  });
  return receipt;
}
