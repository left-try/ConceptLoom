import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getCourse } from "./courses/model.mjs";
import { indexKnowledge, searchKnowledge } from "./knowledge/index.mjs";
import { updateKnowledge } from "./knowledge/update.mjs";

export async function buildStudyContext(root, { courseUid, query, maxChars = 8000 } = {}) {
  if (!Number.isInteger(maxChars) || maxChars < 500 || maxChars > 16000) throw new Error("maxChars must be 500..16000");
  const course = courseUid ? await getCourse(root, { uid: courseUid }) : null;
  let profile = null;
  if (course) { try { profile = JSON.parse(await readFile(join(root, ".concept-loom", "learner-profile.json"), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  const index = await indexKnowledge(root);
  const found = query ? await searchKnowledge(root, { query, limit: 5, scope: "knowledge" }) : { hits: [] };
  const context = {
    course: course && { uid: course.uid, goal: course.goal, status: course.status, currentLessonUid: course.progression.currentLessonUid, nextAction: course.progression.nextAction },
    learnerPreferences: (profile?.observations ?? []).filter((item) => item.basis === "preference").slice(-5),
    knowledge: found.hits.map(({ uid, path, title, excerpt }) => ({ uid, path, title, excerpt })),
  };
  const diagnostics = [];
  while (JSON.stringify(context).length > maxChars && context.knowledge.length) { context.knowledge.pop(); diagnostics.push("Some Knowledge matches were omitted to fit the context limit."); }
  return { context, graphRevision: index.revision, diagnostics };
}

export async function draftKnowledgeNote({ title, body, sourceBindings = [], basis = "learner-provided" }) {
  if (typeof title !== "string" || !title.trim() || typeof body !== "string" || !body.trim()) throw new Error("title and note body are required");
  if (!new Set(["learner-provided", "source-derived", "inferred"]).has(basis)) throw new Error("unsupported knowledge basis");
  return { title: title.trim(), body: body.trim(), basis, sourceBindings: structuredClone(sourceBindings), status: "draft-awaiting-learner-review" };
}

export async function acceptKnowledgeNote(root, { path, expectedHash, blockId, note }) {
  if (!note || note.status !== "draft-awaiting-learner-review") throw new Error("only a reviewed note draft can be accepted");
  const lines = ["## " + note.title, "", note.body, "", "Provenance: " + note.basis + "."];
  for (const binding of note.sourceBindings ?? []) lines.push("- [[" + binding.sourceUid + "]] — " + binding.contentHash + (binding.locator?.value ? " · " + binding.locator.value : ""));
  return updateKnowledge(root, { path, expectedHash, blockId, generatedBody: lines.join("\n") });
}
