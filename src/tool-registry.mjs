import { courseTools } from "./courses/tools.mjs";
import { createExercise, getExercise, submitPractice, assessPractice } from "./practice/model.mjs";
import { importSource, getSource } from "./sources/import.mjs";
import { indexKnowledge, searchKnowledge, getKnowledgeNode, getNeighborhood } from "./knowledge/index.mjs";
import { exportKnowledge } from "./knowledge/export.mjs";
import { buildStudyContext, draftKnowledgeNote, acceptKnowledgeNote } from "./companion.mjs";
import { buildLearningView } from "./ui/views.mjs";

const legacy = ["loom_frame_checkpoint", "loom_assess_checkpoint", "loom_save_learning_state", "loom_load_learning_state", "loom_list_due_reviews", "loom_start_notebook", "loom_add_note", "loom_show_relation_map", "loom_show_text_diagram"]
  .map((name) => ({ name, description: "Existing Concept Loom learning tool.", inputSchema: { type: "object", properties: {} } }));

export async function createToolRegistry(root) {
  const courses = courseTools(root);
  const practice = [
    ["loom_create_exercise", ["uid", "lessonUid", "kind", "publicSpec", "privateCriteria"], { uid: { type: "string" }, lessonUid: { type: "string" }, kind: { enum: ["scenario", "simulation", "coding"] }, publicSpec: { type: "object" }, privateCriteria: { type: "array", items: { type: "string" } }, courseUid: { type: "string" }, sessionId: { type: "string" }, evidenceConcept: { type: "string" } }, createExercise],
    ["loom_get_exercise", ["uid"], { uid: { type: "string" } }, getExercise],
    ["loom_submit_practice", ["exerciseUid", "exerciseRevision", "response"], { attemptId: { type: "string" }, exerciseUid: { type: "string" }, exerciseRevision: { type: "integer" }, response: { type: "string" }, artifacts: { type: "array" }, hintUsed: { type: "boolean" }, confidence: { type: "integer" } }, submitPractice],
    ["loom_assess_practice", ["attemptId", "rubricVersion", "verdict", "criterionResults", "feedback", "nextStep"], { attemptId: { type: "string" }, rubricVersion: { type: "string" }, verdict: { enum: ["accurate", "partial", "needs-repair", "knowledge-gap"] }, criterionResults: { type: "array" }, feedback: { type: "string" }, nextStep: { type: "string" } }, assessPractice],
  ].map(([name, required, properties, handler]) => ({ definition: { name, description: `Concept Loom practice workflow: ${name.replace("loom_", "").replaceAll("_", " ")}.`, inputSchema: { type: "object", required, properties } }, invoke: (args) => handler(root, args) }));
  const knowledge = [
    ["loom_import_source", ["resource", "title", "coverage", "content", "receipt"], { uid: { type: "string" }, resource: { type: "string" }, title: { type: "string" }, author: { type: "string" }, language: { type: "string" }, version: { type: "string" }, coverage: { enum: ["full", "partial", "metadata", "summary", "excerpt", "external"] }, content: { type: "string" }, receipt: { type: "object" } }, importSource],
    ["loom_get_source", ["sourceUid"], { sourceUid: { type: "string" } }, getSource],
    ["loom_search_knowledge", ["query"], { query: { type: "string" }, limit: { type: "integer" }, cursor: { type: "object" }, scope: { enum: ["knowledge", "personal", "all"] } }, searchKnowledge],
    ["loom_read_knowledge", [], { uid: { type: "string" }, path: { type: "string" } }, getKnowledgeNode],
    ["loom_knowledge_graph", ["uid"], { uid: { type: "string" }, depth: { type: "integer" }, limit: { type: "integer" } }, getNeighborhood],
    ["loom_study_context", [], { courseUid: { type: "string" }, query: { type: "string" }, maxChars: { type: "integer" } }, buildStudyContext],
    ["loom_draft_knowledge_note", ["title", "body"], { title: { type: "string" }, body: { type: "string" }, sourceBindings: { type: "array" }, basis: { type: "string" } }, draftKnowledgeNote],
    ["loom_accept_knowledge_note", ["path", "expectedHash", "blockId", "note"], { path: { type: "string" }, expectedHash: { type: "string" }, blockId: { type: "string" }, note: { type: "object" } }, acceptKnowledgeNote],
    ["loom_export_knowledge", [], { format: { enum: ["obsidian", "okf"] }, destination: { type: "string" }, includeAssets: { type: "boolean" } }, exportKnowledge],
    ["loom_index_knowledge", [], {}, indexKnowledge],
    ["loom_open_learning_view", [], { courseUid: { type: "string" }, lessonUid: { type: "string" }, focusUid: { type: "string" }, capabilities: { type: "object" } }, buildLearningView],
  ].map(([name, required, properties, handler]) => ({ definition: { name, description: `Concept Loom knowledge workflow: ${name.replace("loom_", "").replaceAll("_", " ")}.`, inputSchema: { type: "object", required, properties } }, invoke: (args) => name === "loom_draft_knowledge_note" ? handler(args) : handler(root, args) }));
  const catalog = [...legacy, ...courses.map((tool) => tool.definition), ...practice.map((tool) => tool.definition), ...knowledge.map((tool) => tool.definition)];
  const handlers = new Map(courses.map((tool) => [tool.definition.name, tool.invoke]));
  for (const tool of practice) handlers.set(tool.definition.name, tool.invoke);
  for (const tool of knowledge) handlers.set(tool.definition.name, tool.invoke);
  return {
    catalog,
    async invoke(name, args) {
      const invoke = handlers.get(name);
      if (!invoke) throw new Error(`unknown or unavailable tool: ${name}`);
      try { return await invoke(args); }
      catch (error) {
        if (error.code) throw error;
        if (/not found/i.test(error.message)) error.code = "COURSE_NOT_FOUND";
        throw error;
      }
    },
  };
}
