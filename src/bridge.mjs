#!/usr/bin/env node
import readline from "node:readline";
import { createToolRegistry } from "./tool-registry.mjs";
import { resolveWorkspace } from "./workspace.mjs";
import { assertRecovery, recoverTransactions } from "./storage/transactions.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const workspace = resolveWorkspace();
const recoveryDiagnostics = await recoverTransactions(workspace);
for (const diagnostic of recoveryDiagnostics) process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
assertRecovery(recoveryDiagnostics);

const { catalog, invoke } = createToolRegistry(workspace);

async function route(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)
    || message.jsonrpc !== "2.0" || typeof message.method !== "string"
    || (Object.hasOwn(message, "id") && message.id !== null && typeof message.id !== "string" && typeof message.id !== "number")) {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } };
  }
  const { id, method, params = {} } = message;
  if (typeof id === "undefined") return null;
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "concept-loom", version: "1.1.0" },
        instructions: "Use loom tools with the Concept Loom coaching skill. Never expose expected checkpoint answers before the learner responds.",
      },
    };
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: catalog } };
  if (method === "tools/call") {
    try {
      const result = await invoke(params.name, params.arguments || {});
      return { jsonrpc: "2.0", id, result };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        result: { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] },
      };
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } };
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}\n`);
    return;
  }
  try {
    const response = await route(message);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message?.id ?? null, error: { code: -32603, message: String(error) } })}\n`);
  }
});
