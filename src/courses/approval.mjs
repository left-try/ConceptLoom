import { createHash, randomUUID } from "node:crypto";
import { checkRoadmapReadiness } from "./roadmap.mjs";
import { getCourse } from "./model.mjs";
import { courseError, updateCourse } from "./state.mjs";
export { proposeCourseEdit } from "./projections.mjs";

const digest = value => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
function normalizeConsent(consent, shownDigest) {
  if (!consent || typeof consent !== "object" || Array.isArray(consent)) throw courseError("INVALID_CONSENT", "consent must be an object");
  if (consent.shownDigest !== shownDigest) throw courseError("CONSENT_MISMATCH", "consent was recorded for a different or stale displayed digest");
  if (typeof consent.userResponse !== "string" || !consent.userResponse.trim()) throw courseError("INVALID_CONSENT", "consent.userResponse must contain the learner's explicit approval");
  if (typeof consent.host !== "string" || !consent.host.trim()) throw courseError("INVALID_CONSENT", "consent.host is required");
  const recordedAt = consent.recordedAt ?? new Date().toISOString();
  if (typeof recordedAt !== "string" || Number.isNaN(Date.parse(recordedAt))) throw courseError("INVALID_CONSENT", "consent.recordedAt must be a valid timestamp");
  return { ...structuredClone(consent), recordedAt };
}
export async function approveRoadmap(root, { courseUid, roadmapRevision, consent } = {}) {
  const course = await getCourse(root, { uid: courseUid });
  if (!course.roadmapRevision || course.roadmapRevision !== roadmapRevision) throw courseError("ROADMAP_REVISION_MISMATCH", "roadmap changed after it was shown");
  const recordedConsent = normalizeConsent(consent, roadmapRevision);
  const readiness = await checkRoadmapReadiness(root, course);
  if (!readiness.ready) throw courseError("ROADMAP_NOT_READY", readiness.blockers.map(item => item.message).join("; "));
  return updateCourse(root, courseUid, course.revision, current => ({ ...current, status: "approved", approvals: [...current.approvals, { id: randomUUID(), kind: "roadmap", roadmapRevision, consent: recordedConsent }] }));
}
export async function setCoursePaused(root, { courseUid, paused, expectedRevision, reason = "" } = {}) {
  if (typeof paused !== "boolean") throw courseError("INVALID_PAUSE", "paused must be boolean");
  return updateCourse(root, courseUid, expectedRevision, course => {
    if (paused && course.status === "completed") throw courseError("INVALID_TRANSITION", "completed course cannot be paused");
    if (paused) { course.statusBeforePause = course.status; course.status = "paused"; }
    else {
      if (course.status !== "paused") throw courseError("INVALID_TRANSITION", "course is not paused");
      if (course.statusBeforePause === "active") course.status = "active";
      else if (course.approvals.some(item => item.kind === "roadmap" && item.roadmapRevision === course.roadmapRevision)) course.status = "approved";
      else course.status = "roadmap-draft";
      delete course.statusBeforePause;
    }
    course.pauseReason = reason;
    return course;
  });
}
export async function draftSchedule(root, { courseUid, host, timezone, cadence, localTime, missedRunPolicy = "resume-next", progressionPolicy = "wait-for-learner" } = {}) {
  const course = await getCourse(root, { uid: courseUid });
  if (!course.approvals.some(item => item.kind === "roadmap" && item.roadmapRevision === course.roadmapRevision)) throw courseError("ROADMAP_APPROVAL_REQUIRED", "approve roadmap before drafting a schedule");
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { throw courseError("INVALID_TIMEZONE", `invalid IANA timezone ${timezone}`); }
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(localTime ?? "")) throw courseError("INVALID_LOCAL_TIME", "localTime must be HH:mm");
  if (!cadence || !["daily", "weekly"].includes(cadence.kind) || cadence.interval !== 1 || (cadence.kind === "weekly" && (!Array.isArray(cadence.weekdays) || !cadence.weekdays.length || cadence.weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)))) throw courseError("INVALID_CADENCE", "cadence must be daily or weekly with interval 1 and valid weekdays");
  if (missedRunPolicy !== "resume-next" || progressionPolicy !== "wait-for-learner") throw courseError("INVALID_SCHEDULE_POLICY", "unsupported missed-run or progression policy");
  const values = { host, timezone, cadence: structuredClone(cadence), localTime, missedRunPolicy, progressionPolicy, roadmapRevision: course.roadmapRevision };
  const schedule = { id: randomUUID(), ...values, digest: digest(values), status: "draft", createdAt: new Date().toISOString() };
  await updateCourse(root, courseUid, course.revision, current => ({ ...current, scheduleDrafts: [...(current.scheduleDrafts ?? []), schedule] }));
  return schedule;
}
export async function approveSchedule(root, { courseUid, draftId, consent } = {}) {
  const course = await getCourse(root, { uid: courseUid });
  const draft = (course.scheduleDrafts ?? []).find(item => item.id === draftId);
  if (!draft || draft.roadmapRevision !== course.roadmapRevision) throw courseError("SCHEDULE_DRAFT_STALE", "schedule draft missing or roadmap changed");
  const recordedConsent = normalizeConsent(consent, draft.digest);
  if (recordedConsent.host !== draft.host) throw courseError("CONSENT_HOST_MISMATCH", "consent host differs from schedule host");
  const approval = { id: randomUUID(), kind: "schedule", draftId, digest: draft.digest, roadmapRevision: draft.roadmapRevision, status: "approved", consent: recordedConsent };
  await updateCourse(root, courseUid, course.revision, current => ({ ...current, scheduleApprovals: [...(current.scheduleApprovals ?? []), approval] }));
  return approval;
}
