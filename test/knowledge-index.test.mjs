import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { indexKnowledge, getNeighborhood, getKnowledgeNode } from "../src/knowledge/index.mjs";

async function workspace() { return mkdtemp(join(tmpdir(), "loom-graph-")); }
async function note(root, path, uid, title, body, aliases = []) {
  const target = join(root, "vault", "Knowledge", path); await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, `---\ntype: Concept\ntitle: ${JSON.stringify(title)}\naliases: ${JSON.stringify(aliases)}\nconceptloom:\n  profile: conceptloom/1\n  uid: ${uid}\n---\n${body}\n`);
}

test("indexes typed notes and traverses bidirectional graph neighborhood", async () => {
  const root = await workspace(); await note(root, "concepts/a.md", "a", "Alpha", "Связано с [[b]]."); await note(root, "concepts/b.md", "b", "Бета", "Материал");
  const first = await indexKnowledge(root); const second = await indexKnowledge(root);
  assert.equal(first.revision, second.revision); assert.equal(first.edges[0].to, "b");
  assert.equal((await getNeighborhood(root, { uid: "a" })).nodes.length, 2);
  assert.equal((await getKnowledgeNode(root, { uid: "b" })).title, "Бета");
});

test("links inside code fences are ignored and ambiguous wikilinks are diagnostics", async () => {
  const root = await workspace(); await note(root, "one/topic.md", "one", "Topic", "Body\n```md\n[[Ignored]]\n```\n[[Shared]]"); await note(root, "two/topic.md", "two", "Shared", "first"); await note(root, "three/topic.md", "three", "Other", "second", ["Shared"]);
  const index = await indexKnowledge(root);
  assert.equal(index.edges.length, 0); assert.ok(index.diagnostics.some((item) => item.code === "AMBIGUOUS_WIKILINK"));
});

test("search supports Cyrillic aliases and rejects a cursor after index changes", async () => {
  const root = await workspace(); await note(root, "concepts/a.md", "a", "Транзакции", "Уровни изоляции", ["изоляция"]);
  const { searchKnowledge } = await import("../src/knowledge/index.mjs");
  const hits = await searchKnowledge(root, { query: "изоляция" }); assert.equal(hits.hits[0].uid, "a");
  const cursor = { revision: "old", offset: 1 };
  await assert.rejects(searchKnowledge(root, { query: "изоляция", cursor }), { code: "STALE_CURSOR" });
});

test("resolves ordinary relative Markdown links with percent-encoded paths and anchors", async () => {
  const root = await workspace();
  await note(root, "lessons/first.md", "first", "Первый урок", "Перейди к [следующему](../concepts/%D0%A2%D1%80%D0%B0%D0%BD%D0%B7%D0%B0%D0%BA%D1%86%D0%B8%D0%B8.md#isolation).");
  await note(root, "concepts/Транзакции.md", "transactions", "Транзакции", "Уровни изоляции");
  const index = await indexKnowledge(root);
  assert.equal(index.edges.length, 1);
  assert.equal(index.edges[0].to, "transactions");
  assert.equal(index.edges[0].locator.anchor, "isolation");
});
