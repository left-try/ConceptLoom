import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function api() {
  const [{ default: RecordedProvider }, { renderEvalPrompt }, { runOffline }] = await Promise.all([
    import("../evals/providers/recorded.mjs"),
    import("../evals/providers/opf.mjs"),
    import("../scripts/eval-offline.mjs"),
  ]);
  return { RecordedProvider, renderEvalPrompt, runOffline };
}

test("recorded provider serves only the output for the requested case", async () => {
  const { RecordedProvider } = await api();
  assert.equal(typeof RecordedProvider, "function");
  const provider = new RecordedProvider({ config: { outputs: { "case-1": "fixed output" } } });
  const result = await provider.callApi("prompt", { vars: { caseId: "case-1" } });
  assert.equal(provider.id(), "conceptloom-recorded");
  assert.equal(result.output, "fixed output");
});

test("missing recorded output returns an error and never falls back to a provider", async () => {
  const { RecordedProvider } = await api();
  assert.equal(typeof RecordedProvider, "function");
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("network must not be called"); };
  try {
    const result = await new RecordedProvider({ config: { outputs: {} } }).callApi("prompt", { vars: { caseId: "missing" } });
    assert.ok(result.error);
    assert.equal(networkCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("OPF renderer returns ordered role messages and the source digest", async () => {
  const { renderEvalPrompt } = await api();
  assert.equal(typeof renderEvalPrompt, "function");
  const rendered = await renderEvalPrompt({ id: "diagnose", inputs: { context: "synthetic learner context" } });
  assert.match(rendered.digest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(rendered.messages.map(message => message.role), ["system", "developer", "user"]);
  assert.match(rendered.prompt, /synthetic learner context/);
});

test("offline evaluation compares recorded candidates without calling generation or judge providers", async () => {
  const { runOffline } = await api();
  assert.equal(typeof runOffline, "function");
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls += 1; throw new Error("offline mode must not fetch"); };
  try {
    const result = await runOffline({ datasetPath: resolve(root, "evals/datasets/recorded.json") });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.results.map(row => row.caseId), ["recorded-1", "recorded-2"]);
    assert.deepEqual(result.results[0].candidates.map(candidate => candidate.id), ["candidate-a", "candidate-b"]);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("evaluation dependencies remain separate from the core runtime", async () => {
  const core = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const evalPackage = JSON.parse(await readFile(resolve(root, "evals/package.json"), "utf8"));
  assert.equal(Object.hasOwn(core.dependencies ?? {}, "promptfoo"), false);
  assert.equal(evalPackage.dependencies?.promptfoo, "0.124.1");
  const coreCapture = await import("../src/evaluation/capture.mjs");
  assert.equal(typeof coreCapture.validateContract, "function");
});
