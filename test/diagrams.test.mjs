import test from "node:test";
import assert from "node:assert/strict";
import { prepareMermaid, prepareTextDiagram } from "../src/diagrams.mjs";
import * as diagrams from "../src/diagrams.mjs";

function semantic(input) {
  assert.equal(typeof diagrams.renderRelationMap, "function", "semantic renderer must exist");
  return diagrams.renderRelationMap(input);
}

const graph = {
  nodes: [
    { id: "source", label: "Book", kind: "source" },
    { id: "course", label: "Transactions", kind: "course" },
    { id: "lesson", label: "Atomic writes", kind: "lesson", status: "in progress" },
    { id: "concept", label: "Atomicity", kind: "concept" },
  ],
  edges: [
    { from: "source", to: "course", label: "supports" },
    { from: "course", to: "lesson" },
    { from: "lesson", to: "concept", label: "teaches" },
  ],
};

test("returns Mermaid as a terminal-visible fenced block", () => {
  const result = prepareMermaid({ label: "Flow", source: "flowchart LR\n  A --> B" });
  assert.equal(result.format, "mermaid");
  assert.equal(result.markdown, "```mermaid\nflowchart LR\n  A --> B\n```");
});

test("returns a monospace text diagram", () => {
  const result = prepareTextDiagram({ source: "Dockerfile -> Image -> Container" });
  assert.equal(result.format, "text");
  assert.match(result.markdown, /^```text/);
});

test("rejects nested Markdown fences", () => {
  assert.throws(() => prepareMermaid({ source: "```mermaid\ngraph LR" }), /must not include/);
});

test("semantic nodes have consistent styles", () => {
  const result = semantic(graph);
  assert.equal(result.format, "mermaid");
  assert.match(result.source, /flowchart LR/);
  for (const kind of ["source", "course", "lesson", "concept"]) {
    assert.match(result.source, new RegExp(`classDef ${kind} fill:#[a-f0-9]{6},stroke:#[a-f0-9]{6},color:#[a-f0-9]{6}`));
    assert.match(result.source, new RegExp(`n[0-9]+\\["[^"\\n]+"\\]:::${kind}`));
    assert.match(result.source, new RegExp(`subgraph group_${kind}\\["`));
  }
  assert.equal(new Set([...result.source.matchAll(/classDef \w+ fill:(#[a-f0-9]{6})/g)].map(match => match[1])).size, 4);
  assert.match(result.source, /Atomic writes.*in progress/);
  assert.match(result.source, /n3 -->\|"supports"\| n1/);
  assert.equal(result.markdown, `\`\`\`mermaid\n${result.source}\n\`\`\``);
  assert.deepEqual(result, semantic({ nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() }));
});

test("labels remain escaped text", () => {
  const label = '<b>"```"</b> & #34; | ] --> injected';
  const result = semantic({
    nodes: [{ id: 'bad"]; click n0 "evil', label, kind: "concept", status: '<script>alert(1)</script>' }],
    edges: [{ from: 'bad"]; click n0 "evil', to: 'bad"]; click n0 "evil', label }],
    label: '<img src=x> ``` [click](javascript:evil)',
  });
  assert.match(result.source, /htmlLabels":false/);
  assert.match(result.source, /#60;b#62;#34;#96;#96;#96;#34;#60;#47;b#62; #38; #35;34#59;/);
  assert.doesNotMatch(result.source, /<b>|<script>|```|click n0|injected"\]/);
  assert.equal((result.markdown.match(/```/g) || []).length, 2);
  assert.doesNotMatch(result.markdown, /<img|javascript:|\[click\]/);
});

test("missing endpoint fails", () => {
  assert.throws(() => semantic({ nodes: graph.nodes, edges: [{ from: "source", to: "missing" }] }), /endpoint/);
  assert.throws(() => semantic({ nodes: graph.nodes, edges: [{ from: "missing", to: "source" }] }), /endpoint/);
});

test("duplicate node ID fails", () => {
  assert.throws(() => semantic({ nodes: [graph.nodes[0], { ...graph.nodes[0], label: "Other" }], edges: [] }), /duplicate/);
});

test("semantic graph rejects invalid shapes and configuration before generating syntax", () => {
  for (const input of [
    { nodes: [], edges: [] }, { nodes: {}, edges: [] }, { nodes: graph.nodes },
    { nodes: [null], edges: [] }, { nodes: [{ ...graph.nodes[0], id: " " }], edges: [] },
    { nodes: [{ ...graph.nodes[0], label: " " }], edges: [] },
    { nodes: [{ ...graph.nodes[0], kind: "injected" }], edges: [] },
    { nodes: [{ ...graph.nodes[0], status: {} }], edges: [] },
    { ...graph, edges: [null] }, { ...graph, edges: [{ from: 1, to: "course" }] },
    { ...graph, edges: [{ from: "source", to: "course", label: 42 }] },
    { ...graph, direction: "LR\nclick n0 evil" }, { ...graph, theme: "evil" },
  ]) assert.throws(() => semantic(input));
  for (const direction of ["LR", "RL", "TB", "TD", "BT"]) {
    assert.match(semantic({ ...graph, direction }).source, new RegExp(`flowchart ${direction}`));
  }
});

test("semantic labels normalize whitespace and keep a compact readable caption", () => {
  const result = semantic({ nodes: [{ id: "a", kind: "concept", label: `  Alpha\n${"b".repeat(100)} ` }], edges: [], label: "  Learning map  " });
  const label = result.source.match(/n0\["(.*?)"\]/)[1];
  assert.match(label, /^Alpha b/);
  assert.ok(label.length <= 80);
  assert.match(label, /…$/);
  assert.equal(result.markdown.split("\n")[0], "Learning map");
});

test("legacy source still works and is mutually exclusive with semantic input", () => {
  assert.equal(prepareMermaid({ source: " flowchart LR\n  A --> B ", label: "Legacy" }).source, "flowchart LR\n  A --> B");
  assert.match(prepareMermaid(graph).source, /:::concept/);
  for (const semanticFields of [{ nodes: graph.nodes }, { edges: [] }, graph]) {
    assert.throws(() => prepareMermaid({ source: "flowchart LR\nA --> B", ...semanticFields }), /either|exclusive/);
  }
  assert.throws(() => prepareMermaid({ source: " " }), /non-empty/);
});
