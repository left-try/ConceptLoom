import test from "node:test";
import assert from "node:assert/strict";
import { runCodingAttempt } from "../src/practice/coding.mjs";
import { createDockerExecutor } from "../src/practice/executors/docker.mjs";
import { createExercise } from "../src/practice/tools.mjs";
import { makePracticeWorkspace, readWorkspaceFiles, publicSpec } from "./helpers/practice.mjs";

const imageDigest = `sha256:${"0".repeat(64)}`;
async function makeCodingExercise(root, uid = "python-transform") {
  return createExercise(root, {
    uid,
    lessonUid: "data-transform",
    kind: "coding",
    publicSpec: { ...publicSpec, title: "Transform a small dataset" },
    privateCriteria: {
      rubric: [{ id: "transformation", description: "Transform every row." }],
      expectedStdout: "hello",
      runner: { imageDigest, command: ["python", "main.py"], limits: { timeoutMs: 10_000, outputBytes: 65_536, memoryMb: 128, cpuCount: 1, pids: 64 } },
    },
  });
}

test("unavailable executor records an unverified attempt instead of passing it", async t => {
  const root = await makePracticeWorkspace(t);
  const exercise = await makeCodingExercise(root);
  const executorConfig = {
    backend: { available: async () => false, run: async () => { throw new Error("unavailable executor must not run"); } },
  };

  const result = await runCodingAttempt(root, {
    attemptId: "unavailable-run",
    exerciseUid: exercise.uid,
    exerciseRevision: exercise.revision,
    files: { "main.py": "print('hello')" },
    executorConfig,
  });

  assert.equal(result.status, "unavailable");
  assert.notEqual(result.status, "completed");
});

test("learner file paths that escape the staging directory are rejected", async t => {
  const root = await makePracticeWorkspace(t);
  const exercise = await makeCodingExercise(root);

  await assert.rejects(runCodingAttempt(root, {
    attemptId: "path-escape",
    exerciseUid: exercise.uid,
    exerciseRevision: exercise.revision,
    files: { "../outside.py": "print('escape')" },
    executorConfig: {
      backend: { available: async () => true, run: async () => ({ exitCode: 0 }) },
    },
  }), error => error.code === "OUTSIDE_WORKSPACE" || error.code === "INVALID_LEARNER_PATH");
});

test("coding timeout and output overflow are reported distinctly", async t => {
  const root = await makePracticeWorkspace(t);
  const exercise = await makeCodingExercise(root);
  const backend = {
    available: async () => true,
    run: async () => ({ status: "timeout", stdout: "x".repeat(70_000), stderr: "", durationMs: 10_001 }),
  };

  const result = await runCodingAttempt(root, {
    attemptId: "bounded-run",
    exerciseUid: exercise.uid,
    exerciseRevision: exercise.revision,
    files: { "main.py": "print('hello')" },
    executorConfig: { backend },
  });

  assert.equal(result.status, "timeout");
  assert.ok(result.stdout.length <= 65_536);
  assert.equal(result.stdoutTruncated, true);
});

test("Docker backend starts a constrained command without a shell or network", async () => {
  const invocations = [];
  const executor = createDockerExecutor({
    spawn: (...args) => {
      invocations.push(args);
      return { stdout: { on() {} }, stderr: { on() {} }, on(event, handler) { if (event === "close") queueMicrotask(() => handler(0)); }, kill() {} };
    },
  });

  await executor.run({
    stagingPath: "C:/tmp/conceptloom-stage",
    imageDigest,
    command: ["python", "main.py"],
    limits: { timeoutMs: 10_000, outputBytes: 65_536, memoryMb: 128, cpuCount: 1, pids: 64 },
  });

  assert.equal(invocations.length, 2);
  const [binary, args, options] = invocations[1];
  assert.equal(binary, "docker");
  assert.equal(options.shell, false);
  assert.ok(args.includes("--pull=never"));
  assert.ok(args.includes("--network=none"));
  assert.ok(args.includes("--read-only"));
  assert.ok(args.includes("--cap-drop=ALL"));
  assert.ok(args.includes("--security-opt=no-new-privileges"));
  assert.ok(args.some(value => value.startsWith("--memory=")));
  assert.ok(args.some(value => value.startsWith("--cpus=")));
});

test("failed execution keeps submitted source files in durable attempt state", async t => {
  const root = await makePracticeWorkspace(t);
  const exercise = await makeCodingExercise(root);
  await runCodingAttempt(root, {
    attemptId: "failed-source-retained",
    exerciseUid: exercise.uid,
    exerciseRevision: exercise.revision,
    files: { "main.py": "raise RuntimeError('expected failure')" },
    executorConfig: {
      backend: { available: async () => true, run: async () => ({ status: "failed", exitCode: 1, stderr: "expected failure" }) },
    },
  });

  const files = await readWorkspaceFiles(root);
  assert.ok(files.some(file => file.text.includes("raise RuntimeError('expected failure')")));
});
