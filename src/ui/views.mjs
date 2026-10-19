import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getNeighborhood, indexKnowledge } from "../knowledge/index.mjs";
import { resolveContainedPath } from "../storage/paths.mjs";
import { getExercise } from "../practice/tools.mjs";
import { getCourse } from "../courses/model.mjs";
import { prepareMermaid } from "../diagrams.mjs";

export const LEARNING_VIEW_URI = "ui://conceptloom/learning-view.html";
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const uiRoot = join(projectRoot, "ui", "learning-view");

function cleanNode(node) {
  return {
    uid: String(node.uid ?? node.id ?? node.path),
    id: String(node.id ?? node.uid ?? node.path),
    label: String(node.title ?? node.uid ?? node.path),
    kind: String(node.type ?? "concept").toLocaleLowerCase(),
    path: node.path,
    locator: node.locator ? structuredClone(node.locator) : undefined,
  };
}

function escapeJsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export async function buildUiHtml(viewData) {
  const [template, css, script, scenarios] = await Promise.all([
    fs.readFile(join(uiRoot, "index.html"), "utf8"),
    fs.readFile(join(uiRoot, "styles.css"), "utf8"),
    fs.readFile(join(uiRoot, "app.mjs"), "utf8"),
    fs.readFile(join(uiRoot, "scenarios.mjs"), "utf8"),
  ]);
  return template
    .replace("<!--INLINE_STYLES-->", `<style>${css}</style>`)
    .replace("<!--INLINE_SCENARIOS-->", `<script>${scenarios}</script>`)
    .replace("<!--INLINE_SCRIPT-->", `<script>${script}</script>`)
    .replace("<!--VIEW_DATA-->", `<script id="view-data" type="application/json">${escapeJsonForHtml(viewData)}</script>`);
}

function textFallback(viewData) {
  const lines = [`# ${viewData.roadmap?.topic ?? (viewData.lessonUid ? `Урок ${viewData.lessonUid}` : "Граф знаний")}`, ""];
  if (viewData.roadmap) {
    const roadmap = viewData.roadmap;
    lines.push(`Цель: ${roadmap.goal}`, `Версия roadmap: ${roadmap.roadmapRevision ?? "не назначена"}`, "", "## План курса");
    for (const [index, lesson] of roadmap.lessons.entries()) {
      lines.push(`${index + 1}. ${lesson.title} — ${lesson.estimatedMinutes} мин`);
      for (const objective of lesson.objectives) lines.push(`   - Цель: ${objective}`);
      if (lesson.prerequisiteLessonUids.length) lines.push(`   - Сначала: ${lesson.prerequisiteLessonUids.join(", ")}`);
      for (const source of lesson.sources) lines.push(`   - Источник: ${source.title}${source.locator ? ` · ${JSON.stringify(source.locator)}` : ""}`);
    }
    if (roadmap.diagramTruncated) lines.push(`В схеме показаны первые ${roadmap.diagramLessonUids.length} уроков; полный список и источники приведены выше.`);
    if (roadmap.mermaid) lines.push("", roadmap.mermaid);
  }
  if (viewData.focusUid) lines.push(`Фокус: ${viewData.focusUid}`, "");
  if (viewData.nodes.length) {
    lines.push("Связанные узлы:");
    for (const node of viewData.nodes) lines.push(`- ${node.label}${node.path ? ` — ${node.path}` : ""}`);
  } else lines.push("Связанные узлы пока не найдены.");
  if (viewData.exercises.length) {
    lines.push("", "Упражнения:");
    for (const exercise of viewData.exercises) lines.push(`- ${exercise.publicSpec.title ?? exercise.uid} (${exercise.kind}, ${exercise.revision})`);
  }
  lines.push("", "Ответ можно отправить инструментом loom_submit_practice с UID упражнения и показанной revision.");
  return lines.join("\n");
}

async function publicExercises(root, lessonUid) {
  if (!lessonUid) return [];
  const directory = await resolveContainedPath(root, ".concept-loom/practice/exercises");
  const exercises = [];
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const exercise = await getExercise(root, { uid: entry.name.slice(0, -5) });
    if (exercise?.lessonUid === lessonUid) exercises.push(exercise);
  }
  return exercises;
}

async function publicRoadmap(root, courseUid, limit) {
  if (!courseUid) return undefined;
  const course = await getCourse(root, { uid: courseUid });
  const receipts = new Map((course.sourceReceipts ?? []).map(source => [source.sourceUid, source]));
  const lessons = (course.lessons ?? []).map(lesson => ({
    uid: lesson.uid,
    title: lesson.title,
    objectives: (lesson.objectives ?? []).map(String),
    estimatedMinutes: lesson.estimatedMinutes,
    prerequisiteLessonUids: [...(lesson.prerequisiteLessonUids ?? [])],
    sources: (lesson.sourceBindings ?? []).map(binding => {
      const source = receipts.get(binding.sourceUid);
      return {
        sourceUid: binding.sourceUid,
        title: source?.title ?? binding.sourceUid,
        canonicalResource: source?.canonicalResource,
        contentHash: binding.contentHash,
        locator: binding.locator ? structuredClone(binding.locator) : undefined,
      };
    }),
  }));
  const diagramLessons = lessons.slice(0, limit);
  const diagramLessonUids = diagramLessons.map(lesson => lesson.uid);
  const lessonIds = new Set(diagramLessonUids);
  const nodes = diagramLessons.map(lesson => ({ id: lesson.uid, label: lesson.title, kind: "lesson" }));
  const edges = diagramLessons.flatMap(lesson => lesson.prerequisiteLessonUids
    .filter(uid => lessonIds.has(uid))
    .map(uid => ({ from: uid, to: lesson.uid, label: "prerequisite" })));
  const mermaid = diagramLessons.length
    ? prepareMermaid({ nodes, edges, direction: "LR", label: `${course.topic} · prerequisites` }).markdown
    : "";
  return {
    courseUid: course.uid,
    topic: course.topic,
    goal: course.goal,
    roadmapRevision: course.roadmapRevision,
    lessons,
    diagramLessonUids,
    diagramTruncated: lessons.length > diagramLessons.length,
    mermaid,
  };
}

export async function buildLearningView(root, { courseUid, lessonUid, focusUid, capabilities = {}, depth = 1, limit = 50 } = {}) {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) throw new Error("limit must be an integer between 1 and 200");
  let graph;
  if (focusUid) {
    try { graph = await getNeighborhood(root, { uid: focusUid, depth, limit }); }
    catch (error) {
      if (!/Knowledge node not found/.test(error.message)) throw error;
      graph = { nodes: [{ uid: focusUid, id: focusUid, title: focusUid, type: "concept" }], edges: [], truncated: false };
    }
  } else {
    const index = await indexKnowledge(root);
    graph = { nodes: index.nodes.slice(0, limit), edges: index.edges, truncated: index.nodes.length > limit };
  }
  const nodes = graph.nodes.slice(0, limit).map(cleanNode);
  const ids = new Set(nodes.map(node => node.id));
  const pathToId = new Map(nodes.map(node => [node.path, node.id]));
  const edges = graph.edges.map(edge => ({
    from: edge.from,
    to: pathToId.get(edge.to) ?? edge.to,
    kind: edge.kind ?? "related",
    label: edge.kind ?? "related",
  })).filter(edge => ids.has(edge.from) && ids.has(edge.to));
  const exercises = await publicExercises(root, lessonUid);
  const roadmap = await publicRoadmap(root, courseUid, limit);
  const viewData = { courseUid, lessonUid, focusUid, nodes, edges, truncated: Boolean(graph.truncated), roadmap, exercises };
  const result = { viewData, textFallback: textFallback(viewData) };
  if (capabilities.mcpAppUi === true) result.resourceUri = LEARNING_VIEW_URI;
  if (capabilities.localHtml === true) {
    const html = await buildUiHtml(viewData);
    const slug = String(focusUid ?? lessonUid ?? courseUid ?? "learning-view").replace(/[^a-z0-9_-]/gi, "-").slice(0, 64) || "learning-view";
    const relativePath = `.concept-loom/ui/${slug}.html`;
    const path = await resolveContainedPath(root, relativePath, { create: true });
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, html, "utf8");
    result.htmlPath = path;
  }
  return result;
}
