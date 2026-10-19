import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { makeWorkspace } from "./helpers/courses.mjs";

async function startBridge(t, root) {
  const bridgePath = fileURLToPath(new URL("../src/bridge.mjs", import.meta.url));
  const child = spawn(process.execPath, [bridgePath, "--workspace", root]);
  const lines = readline.createInterface({ input: child.stdout });
  const messages = [];
  const pending = new Map();
  let stderr = "";
  let id = 0;
  child.stderr.on("data", chunk => { stderr += chunk; });
  lines.on("line", line => {
    try {
      const message = JSON.parse(line);
      messages.push(message);
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        waiter.resolve(message);
      }
    } catch (error) {
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
    }
  });
  child.on("error", error => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });
  const closed = new Promise(resolve => child.once("close", resolve));
  t.after(() => {
    lines.close();
    child.kill();
  });

  function send(method, params = {}) {
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`bridge timeout; stderr=${stderr}`));
      }, 10_000);
      pending.set(requestId, {
        resolve: message => { clearTimeout(timer); resolve(message); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`);
    });
  }

  return { child, messages, closed, send, call: (name, args) => send("tools/call", { name, arguments: args }) };
}

test("stdio exposes course tools, preserves legacy tools, and emits only JSON-RPC", async t => {
  const root = await makeWorkspace(t);
  const bridge = await startBridge(t, root);
  const initialized = await bridge.send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "course-test", version: "1" },
  });
  assert.equal(initialized.result.protocolVersion, "2025-06-18");

  const listing = await bridge.send("tools/list");
  const names = listing.result.tools.map(tool => tool.name);
  for (const name of [
    "loom_create_course",
    "loom_record_course_research",
    "loom_propose_roadmap",
    "loom_approve_roadmap",
    "loom_claim_lesson",
    "loom_publish_lesson",
    "loom_prepare_native_schedule",
    "loom_bind_native_schedule",
  ]) assert.ok(names.includes(name), `missing ${name}`);
  for (const name of ["loom_frame_checkpoint", "loom_assess_checkpoint", "loom_save_learning_state", "loom_show_relation_map"]) {
    assert.ok(names.includes(name), `lost legacy tool ${name}`);
  }

  const created = await bridge.call("loom_create_course", {
    uid: "stdio-course",
    topic: "Database transactions",
    goal: "Choose an isolation level",
  });
  assert.equal(created.result.isError, undefined, JSON.stringify(created.result));
  const loaded = await bridge.call("loom_get_course", { uid: "stdio-course" });
  assert.equal(loaded.result.isError, undefined, JSON.stringify(loaded.result));
  assert.equal(loaded.result.structuredContent.uid, "stdio-course");

  bridge.child.stdin.end();
  assert.equal(await bridge.closed, 0);
  assert.ok(bridge.messages.length >= 4);
  for (const message of bridge.messages) {
    assert.equal(message.jsonrpc, "2.0");
    assert.ok(Object.hasOwn(message, "result") !== Object.hasOwn(message, "error"));
  }
});
