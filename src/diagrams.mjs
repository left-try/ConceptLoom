function cleanSource(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty text`);
  const source = value.trim();
  if (source.includes("```")) throw new Error(`${label} must not include Markdown fences`);
  return source;
}

export function prepareMermaid(input) {
  const source = cleanSource(input.source, "source");
  return {
    format: "mermaid",
    label: typeof input.label === "string" ? input.label.trim() : "",
    source,
    markdown: `\`\`\`mermaid\n${source}\n\`\`\``,
    instructions: "Show this Mermaid block directly in the response and optionally append it to the Markdown notebook.",
  };
}

function escapeDiagramLabel(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty text`);
  return value.trim().replaceAll("&", "&amp;").replaceAll('"', "#quot;").replaceAll("<", "#lt;").replaceAll(">", "#gt;").replace(/[\r\n]/g, " ");
}

export function renderRelationMap({ nodes, edges, direction = "LR", theme = "neutral", label = "" }) {
  if (!Array.isArray(nodes) || nodes.length === 0) throw new Error("nodes must contain at least one node");
  if (!Array.isArray(edges)) throw new Error("edges must be an array");
  if (!new Set(["LR", "RL", "TB", "BT"]).has(direction)) throw new Error("direction must be LR, RL, TB, or BT");
  if (!new Set(["neutral", "light", "dark"]).has(theme)) throw new Error("theme must be neutral, light, or dark");
  const ids = new Set();
  const normalized = nodes.map((node) => {
    if (!node || typeof node !== "object" || !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(node.id ?? "")) throw new Error("node id must be a stable Mermaid-safe identifier");
    if (ids.has(node.id)) throw new Error(`duplicate node ID '${node.id}'`);
    ids.add(node.id);
    const kind = node.kind ?? "concept";
    if (!new Set(["course", "lesson", "concept", "source", "activity"]).has(kind)) throw new Error(`unknown node kind '${kind}'`);
    return { id: node.id, label: escapeDiagramLabel(node.label, `node '${node.id}' label`), kind };
  });
  const lines = [`flowchart ${direction}`];
  for (const node of normalized) lines.push(`  ${node.id}["${node.label}"]`);
  for (const edge of edges) {
    if (!edge || !ids.has(edge.from) || !ids.has(edge.to)) throw new Error("edge endpoints must reference existing node IDs");
    const edgeLabel = edge.label === undefined ? "" : `|${escapeDiagramLabel(edge.label, "edge label")}|`;
    lines.push(`  ${edge.from} -->${edgeLabel} ${edge.to}`);
  }
  for (const kind of ["course", "lesson", "concept", "source", "activity"]) {
    const members = normalized.filter((node) => node.kind === kind).map((node) => node.id);
    if (members.length) lines.push(`  class ${members.join(",")} loom_${kind}`);
  }
  lines.push("  classDef loom_course fill:#e8e3ff,stroke:#6653a6,color:#20183d");
  lines.push("  classDef loom_lesson fill:#e3f0ff,stroke:#3d73a5,color:#162d43");
  lines.push("  classDef loom_concept fill:#e8f5ee,stroke:#4d8062,color:#1b3324");
  lines.push("  classDef loom_source fill:#fff1d9,stroke:#a97928,color:#493512");
  lines.push("  classDef loom_activity fill:#f0e8f2,stroke:#80628a,color:#302335");
  const source = lines.join("\n");
  return { format: "mermaid", label: typeof label === "string" ? label.trim() : "", source, markdown: `\`\`\`mermaid\n${source}\n\`\`\``, instructions: "Show this learning map directly in the response and optionally append it to the Markdown notebook." };
}

export function prepareTextDiagram(input) {
  const source = cleanSource(input.source, "source");
  return {
    format: "text",
    label: typeof input.label === "string" ? input.label.trim() : "",
    source,
    markdown: `\`\`\`text\n${source}\n\`\`\``,
    instructions: "Show this monospace diagram directly in the terminal response and optionally append it to the Markdown notebook.",
  };
}
