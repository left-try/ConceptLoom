import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { indexKnowledge } from "../src/knowledge/index.mjs";
import { searchKnowledge } from "../src/knowledge/search.mjs";
import { makeWorkspace, note, rootIndex } from "./helpers/knowledge.mjs";

const files = {
  "vault/Knowledge/index.md": rootIndex,
  "vault/Knowledge/concepts/eigenvectors.md": note("Concept", "Eigenvectors", "Eigenvectors keep direction under a linear transformation.", "aliases: [eigenvector, собственный вектор]\nconceptloom:\n  profile: conceptloom/1\n  uid: eigenvectors\n"),
  "vault/Knowledge/concepts/basis.md": note("Concept", "Basis", "A basis spans a vector space.", "aliases: [coordinate frame]\nconceptloom:\n  profile: conceptloom/1\n  uid: basis\n"),
  "vault/Personal/math-notes.md": "# Personal\nEigenvector derivation from my private course.\n",
  ".concept-loom/assessments/answer.json": JSON.stringify({ answerKey: "private eigenvector answer" }),
};

test("searches Unicode-normalized aliases and node body", async t => {
  const root = await makeWorkspace(t, files);
  await indexKnowledge(root);
  const english = await searchKnowledge(root, { query: "eigenvector transformation", scope: "knowledge" });
  const russian = await searchKnowledge(root, { query: "СОБСТВЕННЫЙ ВЕКТОР", scope: "knowledge" });
  assert.equal(english.hits[0].path, "concepts/eigenvectors.md");
  assert.equal(russian.hits[0].path, "concepts/eigenvectors.md");
  assert.match(english.hits[0].excerpt, /transformation/i);
  assert.ok(english.hits[0].score > 0);
});

test("does not return Personal or private assessment data in Knowledge scope", async t => {
  const root = await makeWorkspace(t, files);
  await indexKnowledge(root);
  const result = await searchKnowledge(root, { query: "eigenvector", scope: "knowledge" });
  assert.equal(result.hits.some(hit => hit.path.includes("Personal")), false);
  assert.equal(JSON.stringify(result).includes("private eigenvector answer"), false);
});

test("returns deterministic score ordering and bounded result count", async t => {
  const root = await makeWorkspace(t, files);
  await indexKnowledge(root);
  const first = await searchKnowledge(root, { query: "vector", limit: 2 });
  const again = await searchKnowledge(root, { query: "vector", limit: 2 });
  assert.deepEqual(first.hits, again.hits);
  assert.ok(first.hits.length <= 2);
  assert.ok(first.hits.every(hit => hit.score >= 0));
});

test("paginates without repeating hits and binds cursor to index revision", async t => {
  const root = await makeWorkspace(t, {
    ...files,
    "vault/Knowledge/concepts/transformations.md": note("Concept", "Transformations", "Linear transformations map vectors.", "aliases: [map]\n"),
    "vault/Knowledge/lessons/linear.md": note("Lesson", "Linear lesson", "A vector transformation maps a vector.", ""),
  });
  await indexKnowledge(root);
  const first = await searchKnowledge(root, { query: "vector", limit: 1 });
  assert.ok(first.nextCursor);
  const second = await searchKnowledge(root, { query: "vector", limit: 1, cursor: first.nextCursor });
  assert.notEqual(first.hits[0].path, second.hits[0].path);
  await writeFile(join(root, "vault/Knowledge/concepts/eigenvectors.md"), note("Concept", "Eigenvectors", "Changed.", "aliases: [eigenvector]\n"));
  await indexKnowledge(root);
  await assert.rejects(searchKnowledge(root, { query: "vector", limit: 1, cursor: first.nextCursor }), /cursor|revision|stale/i);
});

test("rejects empty queries and invalid pagination limits", async t => {
  const root = await makeWorkspace(t, files);
  await assert.rejects(searchKnowledge(root, { query: "  " }), /query/i);
  await assert.rejects(searchKnowledge(root, { query: "vector", limit: 0 }), /limit/i);
  await assert.rejects(searchKnowledge(root, { query: "vector", limit: 201 }), /limit/i);
});

test("does not infer semantic support from a text match", async t => {
  const root = await makeWorkspace(t, files);
  await indexKnowledge(root);
  const result = await searchKnowledge(root, { query: "eigenvector", limit: 10 });
  assert.ok(result.hits.length > 0);
  assert.equal(result.hits.some(hit => hit.verified === true || hit.supported === true), false);
});
