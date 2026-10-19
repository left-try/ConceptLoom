import { createHash } from "node:crypto";
import { getCourse } from "./model.mjs";
import { courseError, updateCourse } from "./state.mjs";
import { updateKnowledge } from "../knowledge/update.mjs";
import { resolveContainedPath } from "../storage/paths.mjs";
import { hashBytes } from "../storage/transactions.mjs";
import { readFile } from "node:fs/promises";

const hash = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;
export async function readCourseProjection(root, { courseUid } = {}) {
  const course = await getCourse(root, { uid: courseUid });
  const body = `<!-- conceptloom:course:${course.uid}:start -->\n# ${course.topic}\n\n${course.goal}\n\n${(course.lessons ?? []).map((lesson, index) => `${index + 1}. ${lesson.title} — ${lesson.estimatedMinutes} min`).join("\n")}\n<!-- conceptloom:course:${course.uid}:end -->`;
  return { body, hash: hash(body), manualBody: course.manualProjectionBody ?? "" };
}
export async function proposeCourseEdit(root, { courseUid, projectionHash, proposal } = {}) {
  const current = await readCourseProjection(root, { courseUid });
  if (projectionHash !== current.hash) throw courseError("PROJECTION_HASH_CONFLICT", "projection changed; refresh before proposing an edit");
  const course = await getCourse(root, { uid: courseUid });
  return updateCourse(root, courseUid, course.revision, value => ({ ...value, editProposals: [...(value.editProposals ?? []), { proposal: structuredClone(proposal), createdAt: new Date().toISOString() }] }));
}

export async function exportCourseProjection(root, { courseUid, path, expectedHash } = {}) {
  if (!path || !expectedHash) throw courseError("PROJECTION_HASH_REQUIRED", "path and expectedHash are required to update a Knowledge note safely");
  const projection = await readCourseProjection(root, { courseUid });
  try {
    return await updateKnowledge(root, { path, expectedHash, blockId: `course-${courseUid}`, generatedBody: projection.body });
  } catch (error) {
    if (error.code === "HASH_CONFLICT") throw courseError("PROJECTION_HASH_CONFLICT", error.message);
    throw error;
  }
}

export async function importCourseProjectionEdit(root, { courseUid, path, expectedHash } = {}) {
  if (!path || !expectedHash) throw courseError("PROJECTION_HASH_REQUIRED", "path and expectedHash are required to import a Knowledge edit");
  const file = await resolveContainedPath(root, `vault/Knowledge/${path}`);
  const bytes = await readFile(file);
  const actualHash = hashBytes(bytes);
  if (actualHash !== expectedHash) throw courseError("PROJECTION_HASH_CONFLICT", "Knowledge note changed; refresh before importing the proposed edit");
  const course = await getCourse(root, { uid: courseUid });
  const note = bytes.toString("utf8");
  const marker = `<!-- conceptloom:generated:course-${courseUid}:start -->`;
  const endMarker = `<!-- conceptloom:generated:course-${courseUid}:end -->`;
  const start = note.indexOf(marker), end = note.indexOf(endMarker);
  if (start < 0 || end < start) throw courseError("PROJECTION_BLOCK_NOT_FOUND", "the generated course block is missing from the Knowledge note");
  const proposal = { path, expectedHash, noteContent: note, generatedBlock: note.slice(start + marker.length, end).trim(), importedAt: new Date().toISOString() };
  return updateCourse(root, courseUid, course.revision, current => ({ ...current, editProposals: [...(current.editProposals ?? []), { proposal, createdAt: proposal.importedAt }] }));
}
