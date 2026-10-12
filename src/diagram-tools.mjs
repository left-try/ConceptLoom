import { prepareMermaid, prepareTextDiagram } from "./diagrams.mjs";

export function tools(_root) {
  return [
    {
      definition: {
        name: "loom_show_relation_map",
        description: "Prepare a Mermaid learning map from semantic nodes/edges or legacy source. Show the returned block in the response and optionally save it in the Markdown notebook.",
        inputSchema: {
          type: "object",
          oneOf: [
            { required: ["source", "label"], not: { anyOf: [{ required: ["nodes"] }, { required: ["edges"] }] } },
            { required: ["nodes", "edges"], not: { required: ["source"] } },
          ],
          properties: {
            source: { type: "string", minLength: 1 },
            label: { type: "string", description: "Short caption for the relation map." },
            nodes: {
              type: "array", minItems: 1,
              items: {
                type: "object", required: ["id", "label", "kind"],
                properties: {
                  id: { type: "string", minLength: 1 }, label: { type: "string", minLength: 1 },
                  kind: { enum: ["source", "course", "lesson", "concept"] }, status: { type: "string", minLength: 1 },
                },
              },
            },
            edges: {
              type: "array",
              items: {
                type: "object", required: ["from", "to"],
                properties: { from: { type: "string", minLength: 1 }, to: { type: "string", minLength: 1 }, label: { type: "string", minLength: 1 } },
              },
            },
            direction: { enum: ["LR", "RL", "TB", "TD", "BT"], default: "LR" },
            theme: { enum: ["neutral"], default: "neutral" },
          },
        },
      },
      invoke: prepareMermaid,
    },
    {
      definition: {
        name: "loom_show_text_diagram",
        description: "Prepare a compact monospace text diagram to show directly in the terminal response and optionally save in the Markdown notebook.",
        inputSchema: {
          type: "object", required: ["source", "label"],
          properties: { source: { type: "string" }, label: { type: "string" } },
        },
      },
      invoke: prepareTextDiagram,
    },
  ];
}
