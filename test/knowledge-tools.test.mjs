import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { createHash } from "node:crypto";
import { createToolRegistry } from "../src/tool-registry.mjs";
import { makeWorkspace, note, rootIndex } from "./helpers/knowledge.mjs";

const expected = [
  "loom_import_source", "loom_prepare_source", "loom_get_source",
  "loom_search_knowledge", "loom_read_knowledge", "loom_knowledge_graph",
  "loom_update_knowledge", "loom_export_knowledge",
];
const validArguments = {
  loom_import_source: {
    resource: "https://example.test/x", title: "X", coverage: "metadata",
    receipt: {
      schemaVersion: 1, query: "source", openedResource: "https://example.test/x", fetchedAt: "2026-10-13T08:00:00Z",
      representation: "metadata", coverage: "metadata", limitations: [],
    },
  },
  loom_prepare_source: {
    sourceUid: "source-x",
    extraction: { representation: "extracted", tool: "fixture", toolVersion: "1", sections: [] },
  },
  loom_get_source: { sourceUid: "source-x" },
  loom_search_knowledge: { query: "vectors" },
  loom_read_knowledge: { path: "concepts/vectors.md" },
  loom_knowledge_graph: { uid: "vectors" },
  loom_update_knowledge: { path: "concepts/vectors.md", expectedHash: "sha256:x", blockId: "summary", generatedBody: "Text." },
  loom_export_knowledge: { format: "okf", destination: "exports/knowledge" },
};

test("registers all phase-two tools without removing Foundation or diagram tools", async t => {
  const root = await makeWorkspace(t);
  const { catalog } = createToolRegistry(root);
  const names = catalog.map(item => item.name);
  for (const name of expected) assert.ok(names.includes(name), `${name} is registered`);
  for (const name of [
    "loom_frame_checkpoint", "loom_assess_checkpoint", "loom_start_notebook", "loom_add_note",
    "loom_save_learning_state", "loom_load_learning_state", "loom_list_due_reviews",
    "loom_show_relation_map", "loom_show_text_diagram",
  ]) assert.ok(names.includes(name), `${name} remains registered`);
  assert.equal(new Set(names).size, names.length);
});

test("defines JSON schemas for all added tools and rejects malformed calls", async t => {
  const root = await makeWorkspace(t);
  const { catalog } = createToolRegistry(root);
  const ajv = new Ajv({ strict: false });
  for (const name of expected) {
    const definition = catalog.find(item => item.name === name);
    assert.ok(definition, `${name} is registered`);
    assert.ok(definition.description?.length > 0, `${name} has a description`);
    assert.equal(definition.inputSchema.type, "object", `${name} takes an object`);
    const validate = ajv.compile(definition.inputSchema);
    assert.equal(validate(validArguments[name]), true, `${name} accepts its minimal valid call`);
    assert.equal(validate({}), false, `${name} rejects a call missing required arguments`);
  }
});

test("source tool invocation uses only its configured workspace", async t => {
  const firstRoot = await makeWorkspace(t);
  const secondRoot = await makeWorkspace(t);
  const first = createToolRegistry(firstRoot), second = createToolRegistry(secondRoot);
  const content = "A short, permitted source excerpt.";
  const result = await first.invoke("loom_import_source", {
    uid: "workspace-bound-source", resource: "https://example.test/source", title: "Source",
    coverage: "full", content,
    receipt: {
      schemaVersion: 1, query: "source", openedResource: "https://example.test/source", fetchedAt: "2026-10-13T08:00:00Z",
      representation: "raw", coverage: "full", limitations: [],
    },
  });
  assert.equal(result.structuredContent.uid, "workspace-bound-source");
  const absent = await second.invoke("loom_get_source", { sourceUid: "workspace-bound-source" });
  assert.equal(absent.structuredContent.source, null);
});

test("knowledge reads and search return public nodes without private assessment fields", async t => {
  const root = await makeWorkspace(t, {
    "vault/Knowledge/index.md": rootIndex,
    "vault/Knowledge/concepts/vectors.md": note("Concept", "Vectors", "Magnitude and direction.", "conceptloom:\n  profile: conceptloom/1\n  uid: vectors\n"),
    ".concept-loom/assessments/private.json": JSON.stringify({ expected: "secret", rationale: "private" }),
  });
  const registry = createToolRegistry(root);
  const result = await registry.invoke("loom_search_knowledge", { query: "vectors" });
  assert.ok(result.structuredContent.hits.some(hit => hit.path === "concepts/vectors.md"));
  assert.doesNotMatch(JSON.stringify(result), /secret|private/);
  const read = await registry.invoke("loom_read_knowledge", { path: "concepts/vectors.md" });
  assert.match(read.structuredContent.body, /Magnitude and direction/);
  assert.doesNotMatch(JSON.stringify(read), /expected|rationale/);
});

test("evaluation tools remain optional when phase-two tools are added", async t => {
  const root = await makeWorkspace(t);
  const standard = createToolRegistry(root);
  const enabled = createToolRegistry(root, { evaluationTools: true });
  assert.ok(expected.every(name => standard.catalog.some(tool => tool.name === name)));
  assert.equal(standard.catalog.some(tool => tool.name === "loom_validate_contract"), false);
  assert.equal(enabled.catalog.some(tool => tool.name === "loom_validate_contract"), true);
});

test("prepare, graph, update, and export tools dispatch through the configured workspace", async t => {
  const original = note("Concept", "Vectors", "Magnitude and direction.\n", "conceptloom:\n  profile: conceptloom/1\n  uid: vectors\n");
  const root = await makeWorkspace(t, {
    "vault/Knowledge/index.md": rootIndex,
    "vault/Knowledge/concepts/vectors.md": original,
  });
  const registry = createToolRegistry(root);
  const imported = await registry.invoke("loom_import_source", {
    uid: "tool-source", resource: "https://example.test/tool-source", title: "Tool source",
    coverage: "full", content: "A tool-dispatched source excerpt.",
    receipt: {
      schemaVersion: 1, query: "tool source", openedResource: "https://example.test/tool-source",
      fetchedAt: "2026-10-13T08:00:00Z", representation: "raw", coverage: "full", limitations: [],
    },
  });
  const prepared = await registry.invoke("loom_prepare_source", {
    sourceUid: "tool-source", extraction: {
      representation: "extracted", tool: "test-extractor", toolVersion: "1",
      sections: [{ heading: "Section", text: "Extracted text.", page: 1 }],
    },
  });
  assert.ok(prepared.structuredContent.extraction.contentHash);
  const loaded = await registry.invoke("loom_get_source", { sourceUid: imported.structuredContent.uid });
  assert.equal(loaded.structuredContent.source.uid, "tool-source");
  const graph = await registry.invoke("loom_knowledge_graph", { uid: "vectors", depth: 1 });
  assert.ok(graph.structuredContent.nodes.some(node => node.uid === "vectors"));
  const updated = await registry.invoke("loom_update_knowledge", {
    path: "concepts/vectors.md", expectedHash: createHash("sha256").update(original).digest("hex"),
    blockId: "summary", generatedBody: "Generated source summary.",
  });
  assert.ok(updated.structuredContent.hash);
  const exported = await registry.invoke("loom_export_knowledge", {
    format: "okf", destination: "exports/knowledge",
  });
  assert.equal(exported.structuredContent.format, "okf");
  assert.ok(exported.structuredContent.manifest.files.includes("concepts/vectors.md"));
});
