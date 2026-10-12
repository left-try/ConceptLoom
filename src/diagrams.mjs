function cleanSource(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty text`);
  const source = value.trim();
  if (source.includes("```")) throw new Error(`${label} must not include Markdown fences`);
  return source;
}

export function prepareMermaid(input) {
  const hasSource = Object.hasOwn(input, "source");
  const hasGraph = Object.hasOwn(input, "nodes") || Object.hasOwn(input, "edges");
  if (hasSource && hasGraph) throw new Error("provide either source or semantic nodes/edges; inputs are mutually exclusive");
  if (hasGraph) return renderRelationMap(input);
  const source = cleanSource(input.source, "source");
  return {
    format: "mermaid",
    label: typeof input.label === "string" ? input.label.trim() : "",
    source,
    markdown: `\`\`\`mermaid\n${source}\n\`\`\``,
    instructions: "Show this Mermaid block directly in the response and optionally append it to the Markdown notebook.",
  };
}

const kinds = [
  ["source", "Sources", "#edf2f7", "#718096"],
  ["course", "Courses", "#eeeaf5", "#807296"],
  ["lesson", "Lessons", "#e9f1eb", "#718575"],
  ["concept", "Concepts", "#f7efdf", "#978666"],
];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty text`);
  return value.trim();
}
function compact(value) {
  const text = Array.from(value.replace(/\s+/gu, " "));
  return text.length > 80 ? `${text.slice(0, 79).join("")}…` : text.join("");
}
function escapeText(value, prefix = "#") {
  // Mermaid's decimal entities keep punctuation as label text, including
  // quotes, backticks, HTML and supplied entity syntax. Captions use HTML
  // entities so Markdown cannot turn their text into fences or links.
  return value.replace(/[^\p{L}\p{N} …]/gu, char => `${prefix}${char.codePointAt(0)};`);
}

export function renderRelationMap({ nodes, edges, direction = "LR", theme = "neutral", label = "" }) {
  if (!Array.isArray(nodes) || !nodes.length) throw new Error("nodes must be a non-empty array");
  if (!Array.isArray(edges)) throw new Error("edges must be an array");
  if (!["LR", "RL", "TB", "TD", "BT"].includes(direction)) throw new Error("unsupported direction");
  if (theme !== "neutral") throw new Error("unsupported theme; use neutral");
  if (typeof label !== "string") throw new Error("label must be text");
  const ids = new Map();
  const normalized = nodes.map(node => {
    if (!node || typeof node !== "object" || Array.isArray(node)) throw new Error("node must be an object");
    const id = requiredText(node.id, "node id");
    if (ids.has(id)) throw new Error(`duplicate node ID: ${id}`);
    ids.set(id, null);
    if (!kinds.some(([kind]) => kind === node.kind)) throw new Error("unsupported node kind");
    const text = requiredText(node.label, "node label");
    const status = node.status === undefined ? "" : requiredText(node.status, "node status");
    return { id, kind: node.kind, text: compact(status ? `${text} (${status})` : text) };
  }).sort((a, b) => compare(a.id, b.id));
  normalized.forEach((node, index) => ids.set(node.id, `n${index}`));
  const links = edges.map(edge => {
    if (!edge || typeof edge !== "object" || Array.isArray(edge)) throw new Error("edge must be an object");
    const from = requiredText(edge.from, "edge from"), to = requiredText(edge.to, "edge to");
    if (!ids.has(from) || !ids.has(to)) throw new Error("edge endpoint must name an existing node");
    const text = edge.label === undefined ? "" : compact(requiredText(edge.label, "edge label"));
    return { from, to, text };
  }).sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to) || compare(a.text, b.text));
  const lines = [
    `%%{init: ${JSON.stringify({ theme, securityLevel: "strict", flowchart: { htmlLabels: false } })}}%%`,
    `flowchart ${direction}`,
  ];
  for (const [kind, title] of kinds) {
    const members = normalized.filter(node => node.kind === kind);
    if (!members.length) continue;
    lines.push(`  subgraph group_${kind}["${title}"]`);
    for (const node of members) lines.push(`    ${ids.get(node.id)}["${escapeText(node.text)}"]:::${kind}`);
    lines.push("  end");
  }
  for (const edge of links) lines.push(`  ${ids.get(edge.from)} -->${edge.text ? `|"${escapeText(edge.text)}"|` : ""} ${ids.get(edge.to)}`);
  for (const [kind, , fill, stroke] of kinds) lines.push(`  classDef ${kind} fill:${fill},stroke:${stroke},color:#253041`);
  const source = lines.join("\n"), caption = compact(label.trim());
  return {
    format: "mermaid",
    label: label.trim(),
    source,
    markdown: `${caption ? `${escapeText(caption, "&#")}\n\n` : ""}\`\`\`mermaid\n${source}\n\`\`\``,
    instructions: "Show this Mermaid block directly in the response and optionally append it to the Markdown notebook.",
  };
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
