import { buildLearningView, LEARNING_VIEW_URI } from "./views.mjs";

export function uiTools(root) {
  return [{
    definition: {
      name: "loom_open_learning_view",
      description: "Open a course roadmap or public knowledge graph and lesson exercises inline when MCP Apps are available; returns a readable text fallback otherwise.",
      inputSchema: {
        type: "object",
        properties: {
          courseUid: { type: "string" }, lessonUid: { type: "string" }, focusUid: { type: "string" },
          depth: { type: "integer", minimum: 0, maximum: 3 }, limit: { type: "integer", minimum: 1, maximum: 200 },
          capabilities: { type: "object", properties: { mcpAppUi: { type: "boolean" }, localHtml: { type: "boolean" } } },
        },
      },
      _meta: { ui: { resourceUri: LEARNING_VIEW_URI } },
    },
    invoke: args => buildLearningView(root, args),
  }];
}
