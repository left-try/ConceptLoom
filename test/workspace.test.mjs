import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { resolveWorkspace } from "../src/workspace.mjs";

test("explicit workspace survives a different current directory", () => {
  assert.equal(resolveWorkspace({ cwd: "/other", argv: ["node", "bridge", "--workspace", "./course"], env: {} }), resolve("/other/course"));
});

test("workspace environment overrides cwd when no flag is passed", () => {
  assert.equal(resolveWorkspace({ cwd: "/other", argv: [], env: { CONCEPT_LOOM_WORKSPACE: "./course" } }), resolve("/other/course"));
});

test("missing workspace argument is rejected", () => {
  assert.throws(() => resolveWorkspace({ cwd: "/other", argv: ["node", "bridge", "--workspace"], env: {} }), /requires a path/);
});
