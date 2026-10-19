import fs from "node:fs/promises";
import { commitTransaction } from "../storage/transactions.mjs";
import { resolveContainedPath } from "../storage/paths.mjs";

export const coursePath = uid => `.concept-loom/courses/${uid}.json`;
export const profilePath = ".concept-loom/courses/learner-profile.json";
export function courseError(code, message) { return Object.assign(new Error(`${code}: ${message}`), { code }); }
export function validateUid(uid) {
  if (typeof uid !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(uid)) throw courseError("INVALID_COURSE_UID", "uid must be a short filesystem-safe identifier");
  return uid;
}
export async function readJson(root, path, { optional = false } = {}) {
  try { return JSON.parse(await fs.readFile(await resolveContainedPath(root, path), "utf8")); }
  catch (error) { if (optional && error.code === "ENOENT") return null; throw error; }
}
export async function writeJson(root, path, value, { expectedRevision } = {}) {
  const checks = expectedRevision === undefined ? [] : [{ path, expectedRevision }];
  try { await commitTransaction(root, { checks, writes: [{ path, encoding: "json", value }] }); }
  catch (error) {
    if (error.code === "REVISION_CONFLICT") throw courseError("REVISION_CONFLICT", "state changed since it was read");
    throw error;
  }
  return value;
}
export async function updateCourse(root, uid, expectedRevision, update) {
  validateUid(uid);
  const path = coursePath(uid);
  const course = await readJson(root, path);
  if (course.revision !== expectedRevision) throw courseError("REVISION_CONFLICT", "course revision is stale");
  const next = update(structuredClone(course));
  next.revision = course.revision + 1;
  return writeJson(root, path, next, { expectedRevision });
}
