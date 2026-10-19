import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import readline from "node:readline";
import Ajv from "ajv";

const names = ["loom_frame_checkpoint", "loom_assess_checkpoint", "loom_start_notebook", "loom_add_note", "loom_save_learning_state", "loom_load_learning_state", "loom_list_due_reviews", "loom_show_relation_map", "loom_show_text_diagram", "loom_import_source", "loom_prepare_source", "loom_get_source", "loom_search_knowledge", "loom_read_knowledge", "loom_knowledge_graph", "loom_update_knowledge", "loom_export_knowledge", "loom_create_course", "loom_get_course", "loom_update_course", "loom_update_profile", "loom_record_course_research", "loom_propose_roadmap", "loom_approve_roadmap", "loom_propose_course_edit", "loom_export_course_projection", "loom_import_course_projection_edit", "loom_set_course_paused", "loom_draft_schedule", "loom_approve_schedule", "loom_claim_lesson", "loom_publish_lesson", "loom_complete_lesson", "loom_prepare_native_schedule", "loom_bind_native_schedule", "loom_reconcile_dispatch", "loom_create_exercise", "loom_get_exercise", "loom_submit_practice", "loom_assess_practice", "loom_open_learning_view"];
const graph = { nodes: [{ id: "book", label: "Book", kind: "source" }, { id: "idea", label: "Atomicity", kind: "concept" }], edges: [{ from: "book", to: "idea" }] };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "loom-bridge-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function registry(root) {
  const module = await import("../src/tool-registry.mjs").catch(error => { if (error.code === "ERR_MODULE_NOT_FOUND") return {}; throw error; });
  assert.equal(typeof module.createToolRegistry, "function", "transport-independent registry must exist");
  return module.createToolRegistry(root);
}
function publicOnly(value) {
  if (!value || typeof value !== "object") return;
  for (const key of ["expected", "rationale", "criteria"]) assert.equal(Object.hasOwn(value, key), false, `private ${key} leaked`);
  for (const nested of Object.values(value)) publicOnly(nested);
}
async function bridge(t) {
  const root = await fixture(t);
  const child = spawn(process.execPath, [fileURLToPath(new URL("../src/bridge.mjs", import.meta.url)), "--workspace", root]);
  const pending = new Map(), messages = [];
  let stderr = "", counter = 0;
  child.stderr.on("data", bytes => { stderr += bytes; });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", line => {
    try {
      const message = JSON.parse(line);
      messages.push(message);
      const waiting = pending.get(message.id);
      if (waiting) { pending.delete(message.id); waiting.resolve(message); }
    } catch (error) { for (const waiting of pending.values()) waiting.reject(error); }
  });
  const closed = new Promise(resolve => child.on("close", code => {
    for (const waiting of pending.values()) waiting.reject(new Error(`bridge exited ${code}: ${stderr}`));
    resolve(code);
  }));
  child.on("error", error => { for (const waiting of pending.values()) waiting.reject(error); });
  t.after(() => { lines.close(); child.kill(); });
  function send(method, params = {}) {
    const id = ++counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`bridge timeout: ${stderr}`)); }, 10000);
      pending.set(id, { resolve: message => { clearTimeout(timer); resolve(message); }, reject: error => { clearTimeout(timer); reject(error); } });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
  return { root, child, messages, closed, send, call: (name, args) => send("tools/call", { name, arguments: args }) };
}

test("registry preserves Foundation, Knowledge and Courses tool names and validates relation-map input alternatives", async t => {
  const { catalog, invoke } = await registry(await fixture(t));
  assert.deepEqual(catalog.map(tool => tool.name), names);
  assert.equal(typeof invoke, "function");
  const definition = catalog.find(tool => tool.name === "loom_show_relation_map");
  const validate = new Ajv({ strict: false }).compile(definition.inputSchema);
  for (const input of [{ source: "flowchart LR\nA --> B", label: "Legacy" }, graph]) assert.equal(validate(input), true, JSON.stringify(validate.errors));
  for (const input of [{}, { ...graph, source: "flowchart LR" }, { nodes: graph.nodes }, { source: "flowchart LR", edges: [] }]) assert.equal(validate(input), false);
  for (const args of [{ source: "flowchart LR\nA --> B", label: "Legacy" }, graph]) {
    const result = await invoke("loom_show_relation_map", args);
    assert.equal(result.structuredContent.format, "mermaid");
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  }
  await assert.rejects(invoke("loom_show_relation_map", { ...graph, source: "flowchart LR" }), /either|exclusive/);
  await assert.rejects(invoke("__proto__", {}), /unknown tool/);
});

test("diagram tools expose definition/invoke entries and keep text fallback available", async () => {
  const module = await import("../src/diagram-tools.mjs").catch(error => { if (error.code === "ERR_MODULE_NOT_FOUND") return {}; throw error; });
  assert.equal(typeof module.tools, "function", "diagram module must export tools(root)");
  const entries = module.tools("unused");
  assert.deepEqual(entries.map(entry => entry.definition.name), ["loom_show_relation_map", "loom_show_text_diagram"]);
  const result = await entries[1].invoke({ source: "Book -> Idea", label: "Fallback" });
  assert.equal(result.format, "text");
  assert.equal(result.markdown, "```text\nBook -> Idea\n```");
});

test("registry dispatch binds persistence to its supplied workspace", async t => {
  const root = await fixture(t), other = await fixture(t);
  const first = await registry(root), second = await registry(other);
  await first.invoke("loom_save_learning_state", { sessionId: "lesson", topic: "Atomicity", goal: "Learn", phase: "build", nextStep: "Practice" });
  const loaded = await first.invoke("loom_load_learning_state", { sessionId: "lesson" });
  assert.equal(loaded.structuredContent.state.topic, "Atomicity");
  assert.equal((await second.invoke("loom_load_learning_state", {})).structuredContent.state, null);
  const note = await first.invoke("loom_start_notebook", { path: "notes.md", title: "Atomicity" });
  await first.invoke("loom_add_note", { path: "notes.md", kind: "insight", body: "All writes together" });
  assert.equal(note.structuredContent.path, join(root, "notes.md"));
  assert.match(await readFile(join(root, "notes.md"), "utf8"), /All writes together/);
  assert.deepEqual((await first.invoke("loom_list_due_reviews", { now: "2026-10-12T00:00:00Z" })).structuredContent.due, []);
});

test("MCP serves valid JSON, registers the learning-view resource, and preserves protocol negotiation", async t => {
  const client = await bridge(t);
  const initialized = await client.send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fixture", version: "1" } });
  assert.equal(initialized.result.protocolVersion, "2025-06-18");
  assert.deepEqual(initialized.result.capabilities, { tools: { listChanged: false }, resources: { listChanged: false } });
  assert.equal((await client.send("initialize", { protocolVersion: "2099-01-01" })).result.protocolVersion, "2025-06-18");
  client.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  client.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "ping" })}\n`);
  assert.deepEqual((await client.send("ping")).result, {});
  assert.deepEqual((await client.send("tools/list")).result.tools.map(tool => tool.name), names);
  const semantic = (await client.call("loom_show_relation_map", graph)).result;
  assert.equal(semantic.isError, undefined, JSON.stringify(semantic));
  assert.equal(semantic.structuredContent.format, "mermaid");
  assert.equal((await client.call("loom_show_relation_map", { ...graph, source: "flowchart LR" })).result.isError, true);
  assert.equal((await client.call("missing", {})).result.isError, true);
  const resources = (await client.send("resources/list")).result.resources;
  assert.ok(resources.some(resource => resource.uri === "ui://conceptloom/learning-view.html"));
  const ui = await client.send("resources/read", { uri: "ui://conceptloom/learning-view.html" });
  assert.equal(ui.result.contents[0].mimeType, "text/html;profile=mcp-app");
  client.child.stdin.write("not json\n");
  client.child.stdin.end();
  assert.equal(await client.closed, 0);
  assert.ok(client.messages.some(message => message.error?.code === -32700 && message.id === null));
  for (const message of client.messages) {
    assert.equal(message.jsonrpc, "2.0");
    assert.ok(Object.hasOwn(message, "id"), "notifications must not produce responses");
    assert.ok(Object.hasOwn(message, "result") !== Object.hasOwn(message, "error"));
  }
});

test("JSON-RPC imports a source and searches the same workspace knowledge bundle", async t => {
  const client = await bridge(t);
  await client.send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "knowledge-fixture", version: "1" } });
  client.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const imported = (await client.call("loom_import_source", {
    uid: "bridge-source", resource: "https://example.test/bridge-source", title: "Bridge source",
    coverage: "full", content: "Magnitude and direction define a vector.",
    receipt: {
      schemaVersion: 1, query: "vector definition", openedResource: "https://example.test/bridge-source",
      fetchedAt: "2026-10-13T08:00:00Z", representation: "raw", coverage: "full", limitations: [],
    },
  })).result;
  assert.equal(imported.isError, undefined, JSON.stringify(imported));
  assert.equal(imported.structuredContent.uid, "bridge-source");
  const search = (await client.call("loom_search_knowledge", { query: "magnitude vector" })).result;
  assert.equal(search.isError, undefined, JSON.stringify(search));
  assert.ok(search.structuredContent.hits.length > 0);
  assert.equal(JSON.stringify(search).includes("answerKey"), false);
  client.child.stdin.end();
  assert.equal(await client.closed, 0);
});

test("JSON-RPC notifications never emit a response", async t => {
  const client = await bridge(t);
  client.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "ping" })}\n`);
  client.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "tools/list" })}\n`);
  await client.send("ping");
  client.child.stdin.end();
  assert.equal(await client.closed, 0);
  assert.equal(client.messages.length, 1);
  assert.equal(client.messages[0].id, 1);
});

test("invalid JSON-RPC envelopes return JSON errors and leave the bridge usable", async t => {
  const client = await bridge(t);
  const invalid = [null, [], 42, {}, { jsonrpc: "1.0", method: "ping" }, { jsonrpc: "2.0", method: 42 }, { jsonrpc: "2.0", id: {}, method: "ping" }];
  for (const value of invalid) client.child.stdin.write(`${JSON.stringify(value)}\n`);
  assert.deepEqual((await client.send("ping")).result, {});
  client.child.stdin.end();
  assert.equal(await client.closed, 0);
  assert.equal(client.messages.length, invalid.length + 1);
  for (const message of client.messages.filter(message => message.id !== 1)) {
    assert.equal(message.jsonrpc, "2.0");
    assert.equal(message.id, null);
    assert.equal(message.error.code, -32600);
  }
});

test("stdio frame to assess persists F2 evidence without exposing private grading", async t => {
  const client = await bridge(t);
  const saved = (await client.call("loom_save_learning_state", { sessionId: "lesson", topic: "Atomicity", goal: "Learn", phase: "build", nextStep: "Answer" })).result;
  assert.equal(saved.isError, undefined, JSON.stringify(saved));
  for (const format of ["choice", "free-recall"]) {
    const framed = (await client.call("loom_frame_checkpoint", {
      prompt: "Explain atomicity", format, choices: [{ key: "a", label: "All writes" }, { key: "b", label: "Some writes" }],
      expected: "a", criteria: ["All writes together"], rationale: "Private grading rationale", mix: false,
    })).result;
    publicOnly(framed.structuredContent);
    const args = { token: framed.structuredContent.token, sessionId: "lesson", attemptId: `bridge-${format}`, evidenceConcept: "Atomicity", nextStep: "Transfer", ...(format === "choice" ? { selected: "a" } : { response: "All writes together", verdict: "accurate" }) };
    const result = (await client.call("loom_assess_checkpoint", args)).result;
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(result.structuredContent.attemptId, `bridge-${format}`);
    assert.equal(result.structuredContent.outcome, "accurate");
    assert.equal(result.structuredContent.learningState.nextStep, "Transfer");
    publicOnly(result.structuredContent);
    publicOnly(JSON.parse(result.content[0].text));
    assert.deepEqual((await client.call("loom_assess_checkpoint", args)).result, result);
  }
  const state = JSON.parse(await readFile(join(client.root, ".concept-loom/sessions/lesson.json"), "utf8"));
  assert.equal(state.evidence.Atomicity.attempts, 2);
  publicOnly(state);
});
