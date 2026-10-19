import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { commitTransaction, withWorkspaceLock } from "../storage/transactions.mjs";
import { resolveContainedPath } from "../storage/paths.mjs";
import { getCourse } from "./model.mjs";
import { courseError, coursePath, profilePath, readJson, updateCourse } from "./state.mjs";
import { buildResumeCapsule } from "./capsule.mjs";

const dispatchPath = ".concept-loom/courses/dispatch.json";
async function readDispatch(root) {
  try { return JSON.parse(await readFile(await resolveContainedPath(root, dispatchPath), "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const initial = { schemaVersion: 1, revision: 0, leases: {}, publications: {} };
    await commitTransaction(root, { checks: [{ path: dispatchPath, expectedRevision: null }], writes: [{ path: dispatchPath, encoding: "json", value: initial }] });
    return initial;
  }
}
export async function persistDispatch(root, state, expectedRevision = state.revision - 1) {
  try { await commitTransaction(root, { checks: [{ path: dispatchPath, expectedRevision }], writes: [{ path: dispatchPath, encoding: "json", value: state }] }); }
  catch (error) { if (error.code === "REVISION_CONFLICT") throw courseError("REVISION_CONFLICT", "dispatch state changed concurrently"); throw error; }
}
export async function claimLesson(root, { courseUid, runId, host, now = new Date().toISOString() } = {}) {
  if (!runId || !host || !Number.isFinite(Date.parse(now))) throw courseError("INVALID_RUN", "runId, host and valid now are required");
  return withWorkspaceLock(root, async () => {
    const course = await getCourse(root, { uid: courseUid });
    if (["paused", "completed"].includes(course.status)) return { status: "no-op" };
    if (!course.approvals.some(item => item.kind === "roadmap" && item.roadmapRevision === course.roadmapRevision)) return { status: "blocked", diagnostics: [{ code: "ROADMAP_APPROVAL_REQUIRED" }] };
    const state = await readDispatch(root);
    const uncertain = Object.values(state.leases).find(item => item.courseUid === courseUid && item.status === "publication-unknown");
    if (uncertain) return { status: "blocked", reason: "publication-unknown", runId: uncertain.runId };
    const replayedPublication = state.publications[runId];
    if (replayedPublication) return { status: "published", publication: replayedPublication };
    const replayedLease = Object.values(state.leases).find(item => item.runId === runId);
    if (replayedLease?.status === "claimed" && Date.parse(replayedLease.expiresAt) > Date.parse(now)) {
      const lesson = course.lessons.find(item => item.uid === replayedLease.lessonUid);
      return { status: "claimed", lease: replayedLease, capsule: buildResumeCapsule(course, lesson) };
    }
    const priorPublication = Object.values(state.publications).find(item => item.courseUid === courseUid && item.lessonUid === course.progression.currentLessonUid && item.status === "awaiting-learner");
    if (priorPublication || course.lessons.some(item => item.status === "awaiting-learner")) return { status: "blocked", reason: "awaiting-learner" };
    const lease = Object.values(state.leases).find(item => item.courseUid === courseUid && item.status === "claimed" && Date.parse(item.expiresAt) > Date.parse(now));
    if (lease) return { status: "no-op", reason: "lesson-already-claimed" };
    const expiredClaims = Object.values(state.leases).filter(item => item.courseUid === courseUid && item.status === "claimed" && Date.parse(item.expiresAt) <= Date.parse(now));
    if (expiredClaims.length) {
      for (const item of expiredClaims) item.status = "expired";
      const previousRevision = state.revision; state.revision++;
      await persistDispatch(root, state, previousRevision);
    }
    const lesson = course.lessons.find(item => item.status !== "completed");
    if (!lesson) return { status: "no-op" };
    if (Object.values(state.publications).some(item => item.courseUid === courseUid && item.lessonUid === lesson.uid)) return { status: "blocked", reason: "lesson-already-published" };
    const id = randomUUID();
    const record = { id, leaseId: id, courseUid, lessonUid: lesson.uid, roadmapRevision: course.roadmapRevision, runId, host, status: "claimed", createdAt: now, expiresAt: new Date(Date.parse(now) + 15 * 60_000).toISOString() };
    const previousRevision = state.revision;
    state.leases[id] = record; state.revision++; await persistDispatch(root, state, previousRevision);
    return { status: "claimed", lease: record, capsule: buildResumeCapsule(course, lesson, { profile: await readJson(root, profilePath, { optional: true }) }) };
  });
}
export async function publishLesson(root, { leaseId, runId, artifact, hostChatId, now = new Date().toISOString(), confirmedReconciliation = false } = {}) {
  return withWorkspaceLock(root, async () => {
    const state = await readDispatch(root);
    const old = state.publications[runId];
    if (old) { if (JSON.stringify(old.artifact) !== JSON.stringify(artifact) || old.hostChatId !== hostChatId) throw courseError("PUBLICATION_CONFLICT", "runId was already published with different content"); return old; }
    const lease = state.leases[leaseId];
    const statusAllowed = lease?.status === "claimed" || (confirmedReconciliation && ["publication-unknown", "expired"].includes(lease?.status));
    if (!lease || lease.runId !== runId || !statusAllowed || (!confirmedReconciliation && Date.parse(lease.expiresAt) <= Date.parse(now))) throw courseError("LEASE_INVALID", "a live matching claim or host-confirmed reconciliation is required");
    if (!artifact || artifact.lessonUid !== lease.lessonUid || !artifact.title || !artifact.body || !hostChatId) throw courseError("INVALID_PUBLICATION", "publication requires lesson artifact and confirmed host chat id");
    const course = await getCourse(root, { uid: lease.courseUid });
    const lesson = course.lessons.find(item => item.uid === lease.lessonUid);
    if (!lesson) throw courseError("LESSON_NOT_FOUND", "claimed lesson no longer exists");
    const expectedHashes = (lesson.sourceBindings ?? []).filter(binding => binding.role === "teaching").map(binding => binding.contentHash);
    if (expectedHashes.some(hash => !(artifact.sourceHashes ?? []).includes(hash))) throw courseError("SOURCE_HASH_MISMATCH", "published lesson must cite every bound teaching source hash");
    const receipt = { id: randomUUID(), courseUid: lease.courseUid, lessonUid: lease.lessonUid, roadmapRevision: lease.roadmapRevision, runId, host: lease.host, hostChatId, artifact: structuredClone(artifact), status: "awaiting-learner", createdAt: new Date().toISOString() };
    const updatedCourse = { ...course, revision: course.revision + 1, status: "active", progression: { ...course.progression, currentLessonUid: lesson.uid }, lessons: course.lessons.map(item => item.uid === lesson.uid ? { ...item, status: "awaiting-learner" } : item) };
    const previousRevision = state.revision;
    state.publications[runId] = receipt; lease.status = "published"; state.revision++;
    try { await commitTransaction(root, { checks: [{ path: coursePath(course.uid), expectedRevision: course.revision }, { path: dispatchPath, expectedRevision: previousRevision }], writes: [{ path: coursePath(course.uid), encoding: "json", value: updatedCourse }, { path: dispatchPath, encoding: "json", value: state }] }); }
    catch (error) { if (error.code === "REVISION_CONFLICT") throw courseError("REVISION_CONFLICT", "course or dispatch changed during publication"); throw error; }
    return receipt;
  });
}
export async function completeLesson(root, { courseUid, lessonUid, expectedRevision, evidenceAttemptIds = [] } = {}) {
  if (!Array.isArray(evidenceAttemptIds) || !evidenceAttemptIds.length) throw courseError("EVIDENCE_REQUIRED", "at least one persisted assessment attempt is required");
  const course = await getCourse(root, { uid: courseUid });
  const receipts = [];
  for (const attemptId of evidenceAttemptIds) {
    const path = `.concept-loom/assessments/attempts/${attemptId}.json`;
    const data = JSON.parse(await readFile(await resolveContainedPath(root, path), "utf8"));
    if (data.courseUid !== courseUid || data.lessonUid !== lessonUid || data.attemptId !== attemptId || data.outcome !== "accurate") throw courseError("EVIDENCE_MISMATCH", `assessment attempt ${attemptId} does not provide matching accurate evidence`);
    receipts.push(attemptId);
  }
  return updateCourse(root, courseUid, expectedRevision, current => {
    const lesson = current.lessons.find(item => item.uid === lessonUid);
    if (!lesson || lesson.status !== "awaiting-learner") throw courseError("LESSON_NOT_AWAITING", "lesson must be published before completion");
    lesson.status = "completed"; lesson.evidenceAttemptIds = receipts;
    current.progression.completedLessonUids = [...new Set([...current.progression.completedLessonUids, lessonUid])];
    current.progression.currentLessonUid = undefined;
    if (current.lessons.every(item => item.status === "completed")) current.status = "completed";
    return current;
  });
}
