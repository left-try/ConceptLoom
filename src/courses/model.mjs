import { courseError, coursePath, profilePath, readJson, updateCourse, validateUid, writeJson } from "./state.mjs";

const now = () => new Date().toISOString();
export async function createCourse(root, { uid, topic, goal, level = "unspecified", preferences = {} } = {}) {
  validateUid(uid);
  if (![topic, goal].every(value => typeof value === "string" && value.trim())) throw courseError("INVALID_COURSE", "topic and goal are required");
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) throw courseError("INVALID_COURSE", "preferences must be an object");
  const path = coursePath(uid);
  if (await readJson(root, path, { optional: true })) throw courseError("COURSE_EXISTS", `course ${uid} already exists`);
  const course = {
    schemaVersion: 1, uid, revision: 1, status: "diagnosing", topic: topic.trim(), goal: goal.trim(), level,
    preferences: structuredClone(preferences), diagnostic: { answers: [], frontier: [] },
    roadmapRevision: null, lessons: [], sourceUids: [], sourceReceipts: [], approvals: [],
    progression: { completedLessonUids: [] }, createdAt: now(), updatedAt: now(),
  };
  try { return await writeJson(root, path, course, { expectedRevision: null }); }
  catch (error) { if (error.code === "REVISION_CONFLICT") throw courseError("COURSE_EXISTS", `course ${uid} already exists`); throw error; }
}
export async function getCourse(root, { uid } = {}) {
  validateUid(uid);
  return readJson(root, coursePath(uid));
}
export async function patchCourse(root, { uid, expectedRevision, patch } = {}) {
  const allowed = new Set(["topic", "goal", "level", "preferences", "diagnostic"]);
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some(key => !allowed.has(key))) throw courseError("INVALID_COURSE_PATCH", "patch contains fields owned by a domain transition");
  if (patch.topic !== undefined && !String(patch.topic).trim() || patch.goal !== undefined && !String(patch.goal).trim()) throw courseError("INVALID_COURSE_PATCH", "topic and goal cannot be empty");
  return updateCourse(root, uid, expectedRevision, course => {
    for (const [key, value] of Object.entries(patch)) course[key] = structuredClone(value);
    if (["topic", "goal", "diagnostic"].some(key => Object.hasOwn(patch, key)) && course.roadmapRevision) {
      course.roadmapRevision = null;
      course.status = "roadmap-draft";
      if (course.scheduleBinding?.status === "active") course.scheduleBinding = { ...course.scheduleBinding, status: "stale", staleAt: now() };
    }
    course.updatedAt = now();
    return course;
  });
}
export async function updateLearnerProfile(root, { expectedRevision, observations = [] } = {}) {
  if (!Array.isArray(observations)) throw courseError("INVALID_PROFILE", "observations must be an array");
  for (const entry of observations) if (!entry || typeof entry.field !== "string" || !["self-report", "assessment", "preference"].includes(entry.basis) || typeof entry.recordedAt !== "string") throw courseError("INVALID_PROFILE", "each observation needs field, basis and recordedAt");
  const old = await readJson(root, profilePath, { optional: true });
  const revision = old?.revision ?? 0;
  if (revision !== expectedRevision) throw courseError("REVISION_CONFLICT", "learner profile revision is stale");
  if (!observations.length && old) return old;
  const profile = { schemaVersion: 1, revision: revision + 1, observations: [...(old?.observations ?? []), ...structuredClone(observations)], mastery: old?.mastery ?? {}, updatedAt: now() };
  return writeJson(root, profilePath, profile, { expectedRevision: old ? revision : null });
}
