import { composeCheckpoint } from "./checkpoints.mjs";
import { assessAndPersist } from "./assessment-service.mjs";
import { beginNotebook, addNotebookEntry } from "./notebook.mjs";
import { listDueReviews, loadLearningState, saveLearningState } from "./progress.mjs";
import { tools as diagramTools } from "./diagram-tools.mjs";
import { tools as evaluationTools, captureRestoredState } from "./evaluation/capture.mjs";

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
  ]);
  const entries = [
    ...coreCatalog.map(definition => ({ definition, invoke: handlers.get(definition.name) })),
    ...diagramTools(root),
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
  };
}
