import test from "node:test";
import assert from "node:assert/strict";
import { prepareMermaid, prepareTextDiagram, renderRelationMap } from "../src/diagrams.mjs";

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

test("renders semantic nodes with stable type styles", () => {
  const result = renderRelationMap({ nodes: [{ id: "course", label: "Course", kind: "course" }, { id: "lesson", label: "Lesson", kind: "lesson" }], edges: [{ from: "course", to: "lesson", label: "contains" }] });
  assert.match(result.source, /class course loom_course/);
  assert.match(result.source, /course -->\|contains\| lesson/);
});

test("keeps diagram labels as escaped text", () => {
  const result = renderRelationMap({ nodes: [{ id: "concept", label: 'x"]\nclick x "javascript:alert(1)" <script>', kind: "concept" }], edges: [] });
  assert.doesNotMatch(result.source, /<script>|\nclick/);
  assert.match(result.source, /#lt;script#gt;/);
});

test("rejects duplicate ids and unknown edge endpoints", () => {
  assert.throws(() => renderRelationMap({ nodes: [{ id: "x", label: "x" }, { id: "x", label: "again" }], edges: [] }), /duplicate/);
  assert.throws(() => renderRelationMap({ nodes: [{ id: "x", label: "x" }], edges: [{ from: "x", to: "y" }] }), /endpoints/);
});
