import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveContainedPath } from "../storage/paths.mjs";
import { getCourse } from "../courses/model.mjs";
import { indexKnowledge, getNeighborhood } from "../knowledge/index.mjs";
import { getExercise } from "../practice/model.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
function escapeScriptJson(value) { return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029"); }

export async function buildLearningView(root, { courseUid, lessonUid, focusUid, capabilities = {} } = {}) {
  const course = courseUid ? await getCourse(root, { uid: courseUid }) : null;
  const lesson = course && lessonUid ? course.lessons.find((item) => item.uid === lessonUid) : course?.lessons.find((item) => item.uid === course.progression.currentLessonUid);
  let graph;
  if (focusUid) graph = await getNeighborhood(root, { uid: focusUid, depth: 2, limit: 50 });
  else { const index = await indexKnowledge(root); graph = { nodes: index.nodes.slice(0, 50), edges: index.edges.filter((edge) => index.nodes.slice(0, 50).some((node) => node.uid === edge.from) && index.nodes.slice(0, 50).some((node) => node.uid === edge.to)), truncated: index.nodes.length > 50 }; }
  const publicExercises = [];
  for (const uid of lesson?.exerciseUids ?? []) { try { publicExercises.push(await getExercise(root, { uid })); } catch (error) { if (!/not found/.test(error.message)) throw error; } }
  const viewData = {
    course: course && { uid: course.uid, topic: course.topic, goal: course.goal, status: course.status, nextAction: course.progression.nextAction },
    lesson: lesson && { uid: lesson.uid, title: lesson.title, objectives: lesson.objectives, status: lesson.status },
    graph: { nodes: graph.nodes.map(({ uid, path, type, title, body, aliases }) => ({ uid, path, type, title, body, aliases })), edges: graph.edges, truncated: graph.truncated },
    exercises: publicExercises.map(({ uid, kind, revision, publicSpec }) => ({ uid, kind, revision, publicSpec })),
  };
  const fallback = [viewData.course ? `Course: ${viewData.course.topic} — ${viewData.course.goal}` : "Learning graph", viewData.lesson ? `Lesson: ${viewData.lesson.title} (${viewData.lesson.status})` : "", ...viewData.graph.nodes.map((node) => `${node.type||"note"}: ${node.title} [${node.uid||node.path}]`), ...viewData.graph.edges.map((edge) => `${edge.from} —${edge.kind}→ ${edge.to}`), viewData.graph.truncated ? "Graph view is limited to a bounded neighborhood." : ""].filter(Boolean).join("\n");
  const [template, css, js] = await Promise.all([readFile(join(projectRoot, "ui", "learning-view", "index.html"), "utf8"), readFile(join(projectRoot, "ui", "learning-view", "styles.css"), "utf8"), readFile(join(projectRoot, "ui", "learning-view", "app.mjs"), "utf8")]);
  const html = template.replace("__CSS__", css).replace("__DATA__", escapeScriptJson({ ...viewData, textFallback: fallback })).replace("__APP__", js.replaceAll("</script", "<\\/script"));
  const output = await resolveContainedPath(root, "exports/learning-view.html", { create: true });
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, html, "utf8");
  const textFallback = fallback + (capabilities.localHtml === false ? "\nThis host cannot open local HTML; use the listed notes and Mermaid/text view." : "");
  return { viewData, textFallback, htmlPath: output, diagnostics: graph.truncated ? ["Displayed a bounded graph neighborhood; request a focus node to explore another region."] : [] };
}
