import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("explicit workspace survives different cwd", async t => {
  const root = await mkdtemp(join(tmpdir(), "loom-workspace-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bridge = fileURLToPath(new URL("../src/bridge.mjs", import.meta.url));
  const message = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "loom_save_learning_state", arguments: { sessionId: "explicit", topic: "TLS", goal: "Learn", phase: "build", nextStep: "Continue" } } };
  const result = spawnSync(process.execPath, [bridge, "--workspace", root], { cwd: tmpdir(), input: `${JSON.stringify(message)}\n`, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.result.isError, undefined);
  assert.equal(JSON.parse(await readFile(join(root, ".concept-loom/sessions/explicit.json"))).topic, "TLS");
});

test("workspace resolves flag then environment then cwd and rejects missing flag value", async () => {
  const { resolveWorkspace } = await import("../src/workspace.mjs");
  const cwd = resolve("workspace-base");
  assert.equal(resolveWorkspace({ cwd, argv: [], env: {} }), cwd);
  assert.equal(resolveWorkspace({ cwd, argv: [], env: { CONCEPT_LOOM_WORKSPACE: "environment" } }), resolve(cwd, "environment"));
  assert.equal(resolveWorkspace({ cwd, argv: ["--workspace", "explicit"], env: { CONCEPT_LOOM_WORKSPACE: "environment" } }), resolve(cwd, "explicit"));
  assert.throws(() => resolveWorkspace({ cwd, argv: ["--workspace"], env: {} }), /workspace/);
});
