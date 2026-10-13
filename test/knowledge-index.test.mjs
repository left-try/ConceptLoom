import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { indexKnowledge, getKnowledgeNode, getNeighborhood } from "../src/knowledge/index.mjs";
import { makeWorkspace, note, rootIndex } from "./helpers/knowledge.mjs";

const fixture = {
  "vault/Knowledge/index.md": rootIndex,
  "vault/Knowledge/references/algebra.md": note("Reference", "Algebra text", "Source material.", "resource: https://example.test/algebra\n"),
  "vault/Knowledge/fragments/chapter-1.md": note("Source Fragment", "Chapter one", "Vectors are used in algebra.\n\n[Book](../references/algebra.md#chapter-1).\n", "conceptloom:\n  profile: conceptloom/1\n  uid: fragment-one\n"),
  "vault/Knowledge/concepts/vectors.md": note("Concept", "Vectors", "A vector has magnitude and direction.\n\nSee [[Magnitude]] and [the chapter](../fragments/chapter-1.md).\n", "aliases: [vector, вектор]\nconceptloom:\n  profile: conceptloom/1\n  uid: vectors\n  relations:\n    - kind: supported-by\n      target: fragments/chapter-1.md\n"),
  "vault/Knowledge/concepts/magnitude.md": note("Concept", "Magnitude", "Magnitude is a scalar size.\n", "conceptloom:\n  profile: conceptloom/1\n  uid: magnitude\n"),
  "vault/Knowledge/lessons/lesson-1.md": note("Lesson", "Vector lesson", "Teach vectors using [chapter one](../fragments/chapter-1.md).\n", "conceptloom:\n  profile: conceptloom/1\n  uid: lesson-one\n  relations:\n    - kind: teaches\n      target: concepts/vectors.md\n"),
  "vault/Knowledge/concepts/code-example.md": note("Concept", "Code sample", "Text outside fence.\n\n```md\n[not a link](../references/algebra.md)\n[[Vectors]]\n```\n", "conceptloom:\n  profile: conceptloom/1\n  uid: code-example\n"),
  "vault/Personal/private.md": "# Private\nEigenvector secret note.\n",
  ".concept-loom/assessments/private.json": JSON.stringify({ answerKey: "hidden eigenvector answer" }),
};

test("indexes typed relations and Markdown links as a traversable learning graph", async t => {
  const root = await makeWorkspace(t, fixture);
  const index = await indexKnowledge(root);
  assert.ok(index.revision);
  assert.ok(index.nodes.some(node => node.path === "concepts/vectors.md"));
  assert.ok(index.edges.some(edge => edge.kind === "teaches"));
  assert.ok(index.edges.some(edge => edge.kind === "link" && edge.to === "references/algebra.md"));
  const neighborhood = await getNeighborhood(root, { uid: "lesson-one", depth: 2 });
  assert.ok(neighborhood.nodes.some(node => node.uid === "vectors"));
  assert.ok(neighborhood.edges.length > 0);
});

test("reads a knowledge node by stable UID or bundle-relative path", async t => {
  const root = await makeWorkspace(t, fixture);
  await indexKnowledge(root);
  const byUid = await getKnowledgeNode(root, { uid: "vectors" });
  const byPath = await getKnowledgeNode(root, { path: "concepts/vectors.md" });
  assert.equal(byUid.path, byPath.path);
  assert.match(byUid.body, /magnitude and direction/);
});

test("reports missing and ambiguous link targets without guessing", async t => {
  const files = {
    ...fixture,
    "vault/Knowledge/concepts/one/duplicate.md": note("Concept", "Duplicate", "First.", "aliases: [same-name]\n"),
    "vault/Knowledge/concepts/two/duplicate.md": note("Concept", "Duplicate", "Second.", "aliases: [same-name]\n"),
    "vault/Knowledge/lessons/links.md": note("Lesson", "Links", "[[same-name]] and [missing](../missing.md).\n"),
  };
  const root = await makeWorkspace(t, files);
  const index = await indexKnowledge(root);
  assert.ok(index.diagnostics.some(item => item.code === "AMBIGUOUS_WIKILINK"));
  assert.ok(index.diagnostics.some(item => item.code === "BROKEN_LINK"));
  assert.equal(index.edges.some(edge => edge.to?.includes("duplicate.md") && edge.kind === "wikilink"), false);
});

test("ignores links inside fenced code while preserving links in normal Markdown", async t => {
  const root = await makeWorkspace(t, fixture);
  const index = await indexKnowledge(root);
  const codeNode = index.nodes.find(node => node.path === "concepts/code-example.md");
  const outgoing = index.edges.filter(edge => edge.from === codeNode.id);
  assert.equal(outgoing.some(edge => edge.to === "references/algebra.md"), false);
  assert.equal(outgoing.some(edge => edge.kind === "wikilink"), false);
});

test("resolves percent-encoded relative targets and anchors to the same node", async t => {
  const root = await makeWorkspace(t, {
    ...fixture,
    "vault/Knowledge/concepts/linear space.md": note("Concept", "Linear space", "Definitions.\n"),
    "vault/Knowledge/lessons/encoded.md": note("Lesson", "Encoded", "[Space](../concepts/linear%20space.md#definition).\n"),
  });
  const index = await indexKnowledge(root);
  assert.ok(index.edges.some(edge => edge.to === "concepts/linear space.md" && edge.locator?.anchor === "definition"));
});

test("retains distinct occurrences when canonical edges are merged", async t => {
  const root = await makeWorkspace(t, {
    ...fixture,
    "vault/Knowledge/lessons/two-links.md": note("Lesson", "Two links", "[one](../concepts/vectors.md) and [two](../concepts/vectors.md).\n"),
  });
  const index = await indexKnowledge(root);
  const edge = index.edges.find(item => item.from?.includes("two-links") && item.to === "concepts/vectors.md");
  assert.ok(edge);
  assert.equal(edge.occurrences.length, 2);
  assert.notDeepEqual(edge.occurrences[0].locator, edge.occurrences[1].locator);
});

test("excludes Personal notes and private assessments from the default index", async t => {
  const root = await makeWorkspace(t, fixture);
  const index = await indexKnowledge(root);
  assert.equal(index.nodes.some(node => node.path.startsWith("../Personal") || node.path.includes("private.md")), false);
  assert.equal(JSON.stringify(index).includes("hidden eigenvector answer"), false);
  assert.equal(JSON.stringify(index).includes("Eigenvector secret note"), false);
});

test("indexes Personal only when explicitly requested and keeps its scope separate", async t => {
  const root = await makeWorkspace(t, fixture);
  const index = await indexKnowledge(root, { includePersonal: true });
  const personal = index.nodes.find(node => node.path === "Personal/private.md");
  assert.equal(personal.scope, "personal");
});

test("bounds graph traversal depth and result count and terminates cycles", async t => {
  const root = await makeWorkspace(t, {
    ...fixture,
    "vault/Knowledge/concepts/magnitude.md": note("Concept", "Magnitude", "Magnitude.", "conceptloom:\n  profile: conceptloom/1\n  uid: magnitude\n  relations:\n    - kind: example-of\n      target: concepts/vectors.md\n"),
  });
  await indexKnowledge(root);
  const result = await getNeighborhood(root, { uid: "vectors", depth: 3, limit: 1 });
  assert.equal(result.nodes.length, 1);
  assert.equal(result.truncated, true);
  await assert.rejects(getNeighborhood(root, { uid: "vectors", depth: 4 }), /depth|limit/i);
  await assert.rejects(getNeighborhood(root, { uid: "vectors", depth: 1, limit: 201 }), /depth|limit/i);
});

test("refreshes graph revision when a source note changes", async t => {
  const root = await makeWorkspace(t, fixture);
  const first = await indexKnowledge(root);
  await writeFile(join(root, "vault/Knowledge/concepts/vectors.md"), note("Concept", "Vectors", "Edited body."));
  const second = await indexKnowledge(root);
  assert.notEqual(second.revision, first.revision);
});

test("rejects a requested graph node path outside the Knowledge bundle", async t => {
  const root = await makeWorkspace(t, fixture);
  await assert.rejects(getKnowledgeNode(root, { path: "../../.concept-loom/assessments/private.json" }), /outside|workspace|path/i);
});
