import { composeCheckpoint } from "./checkpoints.mjs";
import { assessAndPersist } from "./assessment-service.mjs";
import { beginNotebook, addNotebookEntry } from "./notebook.mjs";
import { listDueReviews, loadLearningState, saveLearningState } from "./progress.mjs";
import { tools as diagramTools } from "./diagram-tools.mjs";
import { tools as evaluationTools, captureRestoredState } from "./evaluation/capture.mjs";
import { importSource, prepareSource } from "./sources/import.mjs";
import { convertDocument } from "./sources/document-adapter.mjs";
import { indexKnowledge, getKnowledgeNode, getNeighborhood } from "./knowledge/index.mjs";
import { searchKnowledge } from "./knowledge/search.mjs";
import { updateKnowledge } from "./knowledge/update.mjs";
import { exportKnowledge } from "./knowledge/export.mjs";
import fs from "node:fs/promises";
import { resolveContainedPath } from "./storage/paths.mjs";
import { courseTools } from "./courses/tools.mjs";
import { practiceTools } from "./practice/tools.mjs";
import { uiTools } from "./ui/tools.mjs";
import { listUiResources, readUiResource } from "./ui/resources.mjs";

const knowledgeCatalog = [
  { name: "loom_import_source", description: "Import already available source bytes with access coverage and a provenance receipt.", inputSchema: { type: "object", required: ["resource", "title", "coverage", "receipt"], properties: { uid: { type: "string" }, resource: { type: "string", minLength: 1 }, title: { type: "string", minLength: 1 }, author: { type: "string" }, language: { type: "string" }, version: { type: "string" }, coverage: { enum: ["full", "partial", "summary", "metadata", "unknown"] }, content: { type: "string" }, localFile: { type: "string" }, maxAssetBytes: { type: "integer", minimum: 1 }, receipt: { type: "object", required: ["schemaVersion", "query", "openedResource", "fetchedAt", "representation", "coverage", "limitations"], properties: { schemaVersion: { const: 1 }, query: { type: "string" }, openedResource: { type: "string" }, fetchedAt: { type: "string" }, representation: { enum: ["raw", "extracted", "summary", "metadata", "unknown"] }, coverage: { enum: ["full", "partial", "summary", "metadata", "unknown"] }, limitations: { type: "array", items: { type: "string" } } } } } } },
  { name: "loom_prepare_source", description: "Persist a derived extraction with exact source locators, or report a failed extraction.", inputSchema: { type: "object", required: ["sourceUid", "extraction"], properties: { sourceUid: { type: "string" }, extraction: { type: "object" } } } },
  { name: "loom_get_source", description: "Read the source manifest and version history from this workspace.", inputSchema: { type: "object", required: ["sourceUid"], properties: { sourceUid: { type: "string" } } } },
  { name: "loom_search_knowledge", description: "Search Knowledge notes and aliases; Personal results require an explicit scope.", inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string", minLength: 1 }, limit: { type: "integer", minimum: 1, maximum: 200 }, cursor: { type: "string" }, scope: { enum: ["knowledge", "personal", "all"] } } } },
  { name: "loom_read_knowledge", description: "Read one Knowledge note by bundle-relative path or stable ConceptLoom UID.", inputSchema: { type: "object", properties: { path: { type: "string" }, uid: { type: "string" } }, anyOf: [{ required: ["path"] }, { required: ["uid"] }] } },
  { name: "loom_knowledge_graph", description: "Read bounded graph neighborhood or rebuild the local Knowledge index.", inputSchema: { type: "object", properties: { uid: { type: "string" }, depth: { type: "integer", minimum: 0, maximum: 3 }, limit: { type: "integer", minimum: 1, maximum: 200 }, includePersonal: { type: "boolean" } }, anyOf: [{ required: ["uid"] }, { required: ["includePersonal"] }] } },
  { name: "loom_update_knowledge", description: "Update a Knowledge note with an expected content hash and generated block markers.", inputSchema: { type: "object", required: ["path", "expectedHash"], properties: { path: { type: "string" }, expectedHash: { type: "string" }, metadataPatch: { type: "object" }, blockId: { type: "string" }, generatedBody: { type: "string" } } } },
  { name: "loom_export_knowledge", description: "Export a portable OKF or Obsidian vault bundle into a workspace destination.", inputSchema: { type: "object", required: ["format", "destination"], properties: { format: { enum: ["okf", "obsidian"] }, destination: { type: "string" }, includeAssets: { type: "boolean" }, includePersonal: { type: "boolean" } } } },
];


const coreCatalog = [
  {
    name: "loom_frame_checkpoint",
    description: "Create a concealed-answer checkpoint. Supports choice, free-recall, prediction, debugging, and transfer formats. Present only the returned public card, then assess the learner's response.",
    inputSchema: {
      type: "object",
      required: ["prompt", "rationale"],
      properties: {
        prompt: { type: "string" },
        format: { enum: ["choice", "free-recall", "prediction", "debugging", "transfer"], default: "choice" },
        choices: {
          type: "array",
          minItems: 2,
          items: {
            type: "object",
            required: ["key", "label"],
            properties: { key: { type: "string" }, label: { type: "string" } },
          },
        },
        expected: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
        criteria: { type: "array", items: { type: "string" }, description: "Private grading criteria required for non-choice formats." },
        rationale: { type: "string" },
        rubricVersion: { type: "string", description: "Version of the private grading rubric, stored with each attempt." },
        multiple: { type: "boolean", default: false },
        mix: { type: "boolean", default: true },
      },
    },
  },
  {
    name: "loom_assess_checkpoint",
    description: "Grade a checkpoint and atomically persist its evidence and resume point. For an open checkpoint, provide response and a rubric-based verdict. Call immediately after the learner answers.",
    inputSchema: {
      type: "object",
      required: ["token", "sessionId", "nextStep"],
      properties: {
        token: { type: "string" },
        attemptId: { type: "string", description: "Stable attempt ID for reliable retries. Reuse it with the same input; legacy calls receive a generated ID." },
        expectedRevision: { type: ["integer", "null"], minimum: 0 },
        selected: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
        response: { type: "string", description: "Learner's response for a non-choice checkpoint, or __gap__." },
        verdict: { enum: ["accurate", "needs-repair", "knowledge-gap"], description: "Rubric-based outcome for a non-choice response." },
        confidence: { type: "integer", minimum: 0, maximum: 100 },
        sessionId: { type: "string" },
        currentStep: { type: "string" },
        nextStep: { type: "string", description: "Exact action to resume with if the client closes immediately after assessment." },
        securedConnection: { type: "string", description: "Connection to mark secure only when the answer is accurate." },
        gap: { type: "string", description: "Gap to record when the learner selects __gap__." },
        evidenceConcept: { type: "string", description: "Stable concept name whose evidence record this attempt updates." },
        hintUsed: { type: "boolean", default: false },
        note: { type: "string" },
      },
    },
  },
  {
    name: "loom_start_notebook",
    description: "Create or open a Markdown learning notebook inside the current workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", default: "learning-notes.md" },
        title: { type: "string" },
        replace: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "loom_add_note",
    description: "Append a structured learning event to a notebook created with loom_start_notebook.",
    inputSchema: {
      type: "object",
      required: ["path", "kind", "body"],
      properties: {
        path: { type: "string" },
        kind: { enum: ["learner", "guide", "prompt", "response", "insight", "diagram"] },
        body: { type: "string" },
        title: { type: "string" },
      },
    },
  },
  {
    name: "loom_save_learning_state",
    description: "Persist the current route and exact resume point. After every learner response, call this before producing the next explanation or question. Save route approval as phase=build before teaching begins.",
    inputSchema: {
      type: "object",
      required: ["sessionId"],
      properties: {
        sessionId: { type: "string", description: "Stable short id, for example ja4-basics." },
        updateMode: { enum: ["patch", "snapshot"], default: "patch" },
        expectedRevision: { type: ["integer", "null"], minimum: 0 },
        topic: { type: "string" },
        goal: { type: "string" },
        phase: { enum: ["locate", "weave", "build", "transfer", "review", "complete"] },
        mode: { enum: ["guided", "practice", "review", "challenge"], default: "guided" },
        notebookPath: { type: "string" },
        route: { type: "array", items: { type: "string" } },
        secured: { type: "array", items: { type: "string" } },
        gaps: { type: "array", items: { type: "string" } },
        evidence: { type: "object", description: "Per-concept evidence ledger; preserve the complete object on updates." },
        routeExtensions: {
          type: "array",
          description: "Prerequisites discovered after route approval; additions do not replace the approved route.",
          items: {
            type: "object",
            required: ["concept"],
            properties: {
              concept: { type: "string" },
              dependsOn: { type: "array", items: { type: "string" } },
              reason: { type: "string" },
              addedAt: { type: "string" },
            },
          },
        },
        currentStep: { type: "string" },
        nextStep: { type: "string" },
        learnerContext: { type: "string" },
      },
    },
  },
  {
    name: "loom_load_learning_state",
    description: "Load a saved learning session from the workspace. Without sessionId, returns the most recently updated state and a list of all saved sessions. Always call when the learner asks to continue or resume.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" } },
    },
  },
  {
    name: "loom_list_due_reviews",
    description: "List concepts whose delayed retrieval review is due across saved sessions. Use at the start of review mode or when the learner asks what to revisit.",
    inputSchema: {
      type: "object",
      properties: { now: { type: "string", description: "Optional ISO timestamp for deterministic clients and tests." } },
    },
  },
];

function textResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

export function createToolRegistry(root, options = {}) {
  const handlers = new Map([
    ["loom_frame_checkpoint", args => composeCheckpoint(args)],
    ["loom_assess_checkpoint", async args => {
      const { assessment, learningState, attemptId, capture } = await assessAndPersist(root, args, { capture: options.capture !== false, host: options.host ?? "other" });
      return { ...assessment, learningState, attemptId, ...(capture ? { capture } : {}) };
    }],
    ["loom_start_notebook", async args => ({ path: await beginNotebook(root, args) })],
    ["loom_add_note", async args => ({ path: await addNotebookEntry(root, args) })],
    ["loom_save_learning_state", args => saveLearningState(root, args)],
    ["loom_load_learning_state", async args => {
      const loaded = await loadLearningState(root, args);
      return loaded.state && options.capture !== false
        ? { ...loaded, capture: await captureRestoredState(root, loaded.state, { host: options.host ?? "other" }) } : loaded;
    }],
    ["loom_list_due_reviews", args => listDueReviews(root, args)],
    ["loom_import_source", args => importSource(root, args)],
    ["loom_prepare_source", args => prepareSource(root, args)],
    ["loom_get_source", async ({ sourceUid }) => {
      try { const data = JSON.parse(await fs.readFile(await resolveContainedPath(root, ".concept-loom/sources/catalog.json"), "utf8")); return { source: data.sources?.[sourceUid] ?? null }; }
      catch (error) { if (error.code === "ENOENT") return { source: null }; throw error; }
    }],
    ["loom_search_knowledge", args => searchKnowledge(root, args)],
    ["loom_read_knowledge", args => getKnowledgeNode(root, args)],
    ["loom_knowledge_graph", async args => { await indexKnowledge(root, args); return args.uid ? getNeighborhood(root, args) : indexKnowledge(root, args); }],
    ["loom_update_knowledge", args => updateKnowledge(root, args)],
    ["loom_export_knowledge", async args => { const result = await exportKnowledge(root, args); return { format: result.manifest.format, ...result }; }],
  ]);
  const entries = [
    ...coreCatalog.map(definition => ({ definition, invoke: handlers.get(definition.name) })),
    ...diagramTools(root),
    ...knowledgeCatalog.map(definition => ({ definition, invoke: handlers.get(definition.name) })),
    ...courseTools(root, { hostAdapter: options.hostAdapter }),
    ...practiceTools(root),
    ...uiTools(root),
    ...(options.evaluationTools === true ? evaluationTools(root) : []),
  ];
  const byName = new Map(entries.map(entry => [entry.definition.name, entry.invoke]));
  return {
    catalog: entries.map(entry => entry.definition),
    async invoke(name, args = {}) {
      const handler = byName.get(name);
      if (!handler) throw new Error(`unknown tool: ${name}`);
      return textResult(await handler(args));
    },
    async listResources() { return listUiResources(); },
    async readResource(uri) { return readUiResource(uri); },
  };
}
