import { createHash } from "node:crypto";
import { getCourse } from "./model.mjs";
import { indexKnowledge } from "../knowledge/index.mjs";
import { courseError, readJson, updateCourse } from "./state.mjs";

const sha = value => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const catalogPath = ".concept-loom/sources/catalog.json";
function blocker(code, message, extra = {}) { return { code, message, ...extra }; }
export async function checkRoadmapReadiness(root, course) {
  const blockers = [], diagnostics = [];
  const lessons = course?.lessons ?? [];
  const ids = new Set(lessons.map(item => item.uid));
  if (!lessons.length) blockers.push(blocker("NO_LESSONS", "Roadmap must contain at least one lesson."));
  if (ids.size !== lessons.length) blockers.push(blocker("DUPLICATE_LESSON_UID", "Lesson UIDs must be unique."));
  const visiting = new Set(), visited = new Set();
  function visit(uid) {
    if (visiting.has(uid)) return true;
    if (visited.has(uid)) return false;
    visiting.add(uid);
    const lesson = lessons.find(item => item.uid === uid);
    let cycle = false;
    for (const prerequisite of lesson?.prerequisiteLessonUids ?? []) {
      if (!ids.has(prerequisite)) blockers.push(blocker("MISSING_PREREQUISITE", `Lesson ${uid} references missing prerequisite ${prerequisite}.`, { lessonUid: uid }));
      else cycle = visit(prerequisite) || cycle;
    }
    visiting.delete(uid); visited.add(uid);
    if (cycle) blockers.push(blocker("PREREQUISITE_CYCLE", `Prerequisite cycle includes lesson ${uid}.`, { lessonUid: uid }));
    return cycle;
  }
  for (const lesson of lessons) visit(lesson.uid);
  const catalog = await readJson(root, catalogPath, { optional: true }) ?? { sources: {} };
  const knowledge = await indexKnowledge(root);
  const conceptUids = new Set(knowledge.nodes.map(node => node.uid).filter(Boolean));
  const receiptByUid = new Map((course.sourceReceipts ?? []).map(item => [item.sourceUid, item]));
  for (const lesson of lessons) {
    if (!lesson.uid || !lesson.title?.trim() || !Array.isArray(lesson.objectives) || !Number.isFinite(lesson.estimatedMinutes) || lesson.estimatedMinutes <= 0) blockers.push(blocker("INVALID_LESSON", `Lesson ${lesson.uid || "(unnamed)"} has invalid required fields.`, { lessonUid: lesson.uid }));
    for (const conceptUid of lesson.conceptUids ?? []) {
      if (!conceptUids.has(conceptUid)) blockers.push(blocker("CONCEPT_NOT_FOUND", `Concept ${conceptUid} is not present in the Knowledge index.`, { conceptUid, lessonUid: lesson.uid }));
      const applicable = (lesson.sourceBindings ?? []).filter(binding => binding.role === "teaching" && binding.coverage === "full" && (receiptByUid.has(binding.sourceUid)));
      for (const binding of (lesson.sourceBindings ?? []).filter(item => item.role === "teaching" && item.coverage === "full")) {
        const source = catalog.sources?.[binding.sourceUid];
        if (source && source.currentContentHash === binding.contentHash) {
          const locatorPresent = source.receipt?.locators?.some(item => item.kind === binding.locator?.kind && item.value === binding.locator?.value && (item.contentHash === binding.contentHash || !item.contentHash));
          if (!locatorPresent) blockers.push(blocker("SOURCE_LOCATOR_NOT_FOUND", `Teaching source locator for ${binding.sourceUid} is not present in its import receipt.`, { sourceUid: binding.sourceUid, lessonUid: lesson.uid }));
        }
      }
      const good = applicable.some(binding => {
        const source = catalog.sources?.[binding.sourceUid];
        const locatorPresent = source?.receipt?.locators?.some(item => item.kind === binding.locator?.kind && item.value === binding.locator?.value && (item.contentHash === binding.contentHash || !item.contentHash));
        return source && source.currentContentHash === binding.contentHash && binding.locator?.contentHash === binding.contentHash && locatorPresent && source.coverage === "full" && source.status === "ready";
      });
      if (!good) blockers.push(blocker("TEACHING_SOURCE_REQUIRED", `Concept ${conceptUid} needs an accessible, hash-matched teaching source.`, { conceptUid, lessonUid: lesson.uid }));
    }
  }
  for (const receipt of course.sourceReceipts ?? []) if (receipt.receipt?.limitations?.length) diagnostics.push({ code: "SOURCE_LIMITATIONS", sourceUid: receipt.sourceUid, message: receipt.receipt.limitations.join("; ") });
  if ((course.sourceReceipts ?? []).filter(item => item.coverage === "full").length > 1) diagnostics.push({ code: "SOURCE_CONFLICT_REVIEW", message: "Multiple sources are available; compare statements and disclose unresolved conflicts." });
  return { ready: blockers.length === 0, blockers, diagnostics };
}
export async function proposeRoadmap(root, { courseUid, expectedRevision, lessons, adaptedFrom = [] } = {}) {
  if (!Array.isArray(lessons) || !lessons.length) throw courseError("INVALID_ROADMAP", "lessons must be a non-empty array");
  if (new Set(lessons.map(item => item?.uid)).size !== lessons.length) throw courseError("DUPLICATE_LESSON_UID", "lesson UIDs must be unique");
  const clean = lessons.map(item => ({
    uid: item.uid, title: item.title, objectives: item.objectives ?? [], conceptUids: item.conceptUids ?? [],
    prerequisiteLessonUids: item.prerequisiteLessonUids ?? [], sourceBindings: item.sourceBindings ?? [],
    exerciseUids: item.exerciseUids ?? [], estimatedMinutes: item.estimatedMinutes, status: item.status ?? "pending",
  }));
  if (clean.some(item => typeof item.uid !== "string" || !item.uid || typeof item.title !== "string" || !item.title.trim() || !Number.isFinite(item.estimatedMinutes) || item.estimatedMinutes <= 0)) throw courseError("INVALID_ROADMAP", "each lesson needs uid, title and positive estimatedMinutes");
  const course = await getCourse(root, { uid: courseUid });
  if (course.revision !== expectedRevision) throw courseError("REVISION_CONFLICT", "course revision is stale");
  const proposed = { ...course, lessons: clean, sourceUids: [...new Set([...course.sourceUids, ...clean.flatMap(item => item.sourceBindings.map(binding => binding.sourceUid)), ...adaptedFrom.map(item => item.sourceUid)])], adaptedFrom: structuredClone(adaptedFrom), roadmapRevision: sha({ lessons: clean, goal: course.goal, adaptedFrom }), status: "roadmap-draft" };
  const readiness = await checkRoadmapReadiness(root, proposed);
  const updated = await updateCourse(root, courseUid, expectedRevision, current => {
    const next = { ...current, lessons: clean, sourceUids: proposed.sourceUids, adaptedFrom: proposed.adaptedFrom, roadmapRevision: proposed.roadmapRevision, status: "roadmap-draft", readiness, updatedAt: new Date().toISOString() };
    if (current.scheduleBinding?.status === "active") next.scheduleBinding = { ...current.scheduleBinding, status: "stale", staleAt: new Date().toISOString() };
    else if (current.scheduleBinding === undefined) delete next.scheduleBinding;
    return next;
  });
  return { course: updated, readiness };
}
