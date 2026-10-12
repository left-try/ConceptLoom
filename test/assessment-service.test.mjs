import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { composeCheckpoint, resetCheckpointsForTests } from "../src/checkpoints.mjs";
import { loadLearningState, saveLearningState, recordCheckpointAssessment } from "../src/progress.mjs";

const serviceUrl = new URL("../src/assessment-service.mjs", import.meta.url).href;
async function service() {
  const module = await import(serviceUrl).catch(error => { if (error.code === "ERR_MODULE_NOT_FOUND") return {}; throw error; });
  assert.equal(typeof module.assessAndPersist, "function", "assessment service must exist");
  return module.assessAndPersist;
}
async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), "loom-assessment-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await saveLearningState(root, { sessionId: "lesson", topic: "Transactions", goal: "Learn atomicity", phase: "build", currentStep: "Atomicity", nextStep: "Answer", route: ["Atomicity"], routeExtensions: [{ concept: "Isolation", dependsOn: ["Atomicity"] }] });
  return root;
}
function card(format = "choice") {
  const publicCard = composeCheckpoint({ prompt: "Explain atomicity", format, choices: [{ key: "a", label: "All or nothing" }, { key: "b", label: "Some writes" }], expected: "a", criteria: ["All writes succeed together"], rationale: "Atomicity commits all writes together.", rubricVersion: "atomicity/2", mix: false });
  assert.equal("expected" in publicCard, false);
  assert.equal("rationale" in publicCard, false);
  assert.equal("criteria" in publicCard, false);
  return publicCard;
}
function request(publicCard, overrides = {}) {
  return { token: publicCard.token, sessionId: "lesson", nextStep: "Transfer", evidenceConcept: "Atomicity", selected: "a", confidence: 80, attemptId: "attempt-1", ...overrides };
}
async function state(root) { return (await loadLearningState(root, { sessionId: "lesson" })).state; }
async function receipt(root, id = "attempt-1") { return JSON.parse(await fs.readFile(join(root, `.concept-loom/assessments/attempts/${id}.json`), "utf8")); }
function assertPublic(value) {
  if (!value || typeof value !== "object") return;
  for (const key of ["expected", "rationale", "criteria"]) assert.equal(Object.hasOwn(value, key), false, `private ${key} must stay in the receipt`);
  for (const nested of Object.values(value)) assertPublic(nested);
}
function child(source, args) {
  return new Promise((resolve, reject) => {
    const runner = spawn(process.execPath, ["--input-type=module", "-e", source, ...args]);
    let stdout = "", stderr = "";
    runner.stdout.on("data", bytes => { stdout += bytes; });
    runner.stderr.on("data", bytes => { stderr += bytes; });
    runner.on("error", reject);
    runner.on("close", code => resolve({ code, stdout, stderr }));
  });
}
test.beforeEach(() => resetCheckpointsForTests());

for (const format of ["choice", "free-recall"]) {
  test(`ordinary session and service response omit private ${format} grading details`, async t => {
    const assess = await service(), root = await fixture(t);
    const input = request(card(format), format === "choice" ? {} : { selected: undefined, response: "All writes or none", verdict: "accurate" });
    const result = await assess(root, input);
    const disk = JSON.parse(await fs.readFile(join(root, ".concept-loom/sessions/lesson.json"), "utf8"));
    assertPublic(disk);
    assertPublic(result);
    assertPublic(await assess(root, input));
    const privateReceipt = await receipt(root);
    assert.equal(privateReceipt.assessment.rationale, "Atomicity commits all writes together.");
    if (format === "choice") assert.deepEqual(privateReceipt.assessment.expected, ["a"]);
    else assert.deepEqual(privateReceipt.assessment.criteria, ["All writes succeed together"]);
    assert.equal(disk.evidence.Atomicity.history[0].rubricVersion, "atomicity/2");
    assert.equal(disk.evidence.Atomicity.history[0].confidence, 80);
    assert.equal(disk.evidence.Atomicity.history[0].outcome, "accurate");
  });
}

test("failed commit keeps card usable", async t => {
  const assess = await service(), root = await fixture(t), input = request(card());
  const rename = fs.rename;
  fs.rename = async (...args) => {
    if (String(args[1]).includes(`${join("storage", "transactions")}`)) throw Object.assign(new Error("injected persistence error"), { code: "EIO" });
    return rename(...args);
  };
  try { await assert.rejects(assess(root, input), /injected persistence error/); }
  finally { fs.rename = rename; }
  assert.equal((await state(root)).revision, 1);
  await assert.rejects(receipt(root), { code: "ENOENT" });
  const result = await assess(root, input);
  assert.equal(result.learningState.evidence.Atomicity.attempts, 1);
  assert.equal(result.learningState.revision, 2);
});

test("same attempt returns receipt after restart", async t => {
  const assess = await service(), root = await fixture(t), input = request(card(), { expectedRevision: 1, hintUsed: false });
  const first = await assess(root, input);
  await saveLearningState(root, { sessionId: "lesson", nextStep: "Later" });
  const replay = await child(`import { assessAndPersist } from ${JSON.stringify(serviceUrl)}; console.log(JSON.stringify(await assessAndPersist(process.argv[1], JSON.parse(process.argv[2]))));`, [root, JSON.stringify(input)]);
  assert.equal(replay.code, 0, replay.stderr);
  assert.deepEqual(JSON.parse(replay.stdout), JSON.parse(JSON.stringify(first)));
  assert.equal((await state(root)).evidence.Atomicity.attempts, 1);
  assert.equal((await state(root)).revision, 3);
  const saved = await receipt(root);
  assert.equal(saved.attemptId, "attempt-1");
  assert.deepEqual(saved.learningState, JSON.parse(JSON.stringify(first.learningState)));
  assert.equal(saved.assessment.rationale, "Atomicity commits all writes together.");
  const attempt = saved.learningState.evidence.Atomicity.history[0];
  assert.equal(attempt.attemptId, "attempt-1");
  assert.equal(attempt.dimension, "recognition");
  assert.equal(attempt.rubricVersion, "atomicity/2");
  assert.equal(attempt.confidence, 80);
  assert.equal(attempt.hintUsed, false);
  assert.deepEqual(attempt.selected, ["a"]);
});

test("same attempt with different input conflicts", async t => {
  const assess = await service(), root = await fixture(t), input = request(card());
  const first = await assess(root, input);
  for (const changed of [{ selected: "b" }, { hintUsed: true }, { nextStep: "Different" }, { confidence: 81 }]) {
    await assert.rejects(assess(root, { ...input, ...changed }), { code: "ATTEMPT_CONFLICT" });
  }
  assert.deepEqual(await state(root), JSON.parse(JSON.stringify(first.learningState)));
});

test("parallel same token records once", async t => {
  const assess = await service(), root = await fixture(t), input = request(card());
  const identical = await Promise.all([assess(root, input), assess(root, { ...input })]);
  assert.deepEqual(identical[0], identical[1]);
  assert.equal((await state(root)).evidence.Atomicity.attempts, 1);
  const second = request(card(), { attemptId: "attempt-2" });
  const competing = await Promise.allSettled([assess(root, second), assess(root, { ...second, attemptId: "attempt-3" })]);
  assert.equal(competing.filter(entry => entry.status === "fulfilled").length, 1);
  assert.match(competing.find(entry => entry.status === "rejected").reason.message, /unknown or expired/);
  assert.equal((await state(root)).evidence.Atomicity.attempts, 2);
});

test("hinted success is not unaided retrieval", async t => {
  const assess = await service(), root = await fixture(t);
  const first = await assess(root, request(card("free-recall"), { selected: undefined, response: "All writes or none", verdict: "accurate" }));
  const unaided = first.learningState.evidence.Atomicity;
  assert.equal(unaided.consecutiveSuccesses, 1);
  const hinted = await assess(root, request(card("transfer"), { attemptId: "hinted", selected: undefined, response: "All writes together", verdict: "accurate", hintUsed: true }));
  const evidence = hinted.learningState.evidence.Atomicity;
  assert.equal(evidence.attempts, 2);
  assert.equal(evidence.successes, 2);
  assert.equal(evidence.consecutiveSuccesses, 1);
  assert.equal(evidence.lastSuccessfulRetrieval, unaided.lastSuccessfulRetrieval);
  assert.equal(evidence.transferPassed, false);
  assert.equal(evidence.dimensions.transfer, "assisted");
  assert.equal(evidence.history[1].hintUsed, true);
  assert.equal(evidence.history[1].assistance, "hint");
  assert.equal(new Date(evidence.reviewAfter) - new Date(evidence.lastAttemptAt), 86400000);
});

test("review intervals are one day, three days, and one day after failure", async t => {
  const assess = await service(), root = await fixture(t);
  for (const [index, selected, days, streak] of [[1, "a", 1, 1], [2, "a", 3, 2], [3, "b", 1, 0]]) {
    const result = await assess(root, request(card(), { attemptId: `interval-${index}`, selected }));
    const evidence = result.learningState.evidence.Atomicity;
    assert.equal(evidence.consecutiveSuccesses, streak);
    assert.equal(new Date(evidence.reviewAfter) - new Date(evidence.lastAttemptAt), days * 86400000);
  }
});

test("invalid persistence input and stale revision preserve a usable card", async t => {
  const assess = await service(), root = await fixture(t), input = request(card());
  for (const invalid of [{ sessionId: "../escape" }, { attemptId: "../escape" }, { nextStep: " " }, { currentStep: 42 }, { currentStep: " " }, { hintUsed: "false" }, { selected: "missing" }, { expectedRevision: 0 }, { expectedRevision: null }]) {
    await assert.rejects(assess(root, { ...input, ...invalid }));
    assert.equal((await state(root)).revision, 1);
    await assert.rejects(receipt(root), { code: "ENOENT" });
  }
  assert.equal((await assess(root, input)).learningState.revision, 2);
});

test("concept names matching object properties retain their evidence", async t => {
  const assess = await service(), root = await fixture(t);
  const first = await assess(root, request(card(), { evidenceConcept: "__proto__" }));
  assert.equal(Object.hasOwn(first.learningState.evidence, "__proto__"), true);
  assert.equal(first.learningState.evidence.__proto__.attempts, 1);
  const next = await assess(root, request(card(), { attemptId: "proto-next", evidenceConcept: "__proto__" }));
  assert.equal(next.learningState.evidence.__proto__.attempts, 2);
  assert.equal(next.learningState.evidence.__proto__.history.length, 2);
});

test("legacy request receives an attempt ID for durable retries", async t => {
  const assess = await service(), root = await fixture(t), input = request(card());
  delete input.attemptId;
  const result = await assess(root, input);
  assert.match(result.attemptId, /^[a-z0-9_-]+$/i);
  assert.deepEqual(await assess(root, { ...input, attemptId: result.attemptId }), result);
  assert.equal((await state(root)).evidence.Atomicity.attempts, 1);
});

test("partial commit recovers a consistent receipt without a second attempt", async t => {
  const assess = await service(), root = await fixture(t), input = request(card());
  const rename = fs.rename;
  fs.rename = async (...args) => {
    await rename(...args);
    if (String(args[1]).endsWith(`${join("sessions", "lesson.json")}`)) throw Object.assign(new Error("interrupted after state rename"), { code: "EIO" });
  };
  try { await assert.rejects(assess(root, input), /interrupted after state rename/); }
  finally { fs.rename = rename; }
  const result = await assess(root, input);
  assert.equal(result.learningState.evidence.Atomicity.attempts, 1);
  assert.equal(result.learningState.revision, 2);
  assert.deepEqual(await state(root), result.learningState);
  assert.deepEqual((await receipt(root)).learningState, result.learningState);
  await assert.rejects(assess(root, { ...input, attemptId: "second" }), /unknown or expired/);
});

test("recovered commit cannot assess the same token under a new attempt ID", async t => {
  const assess = await service(), root = await fixture(t), input = request(card());
  const rename = fs.rename;
  fs.rename = async (...args) => {
    await rename(...args);
    if (String(args[1]).endsWith(`${join("sessions", "lesson.json")}`)) throw new Error("interrupted state commit");
  };
  try { await assert.rejects(assess(root, input), /interrupted state commit/); }
  finally { fs.rename = rename; }
  // A different storage consumer can recover first, while the process-local
  // card remains active after the failed call.
  assert.equal((await state(root)).evidence.Atomicity.attempts, 1);
  await assert.rejects(assess(root, { ...input, attemptId: "new-id" }), /unknown or expired/);
  assert.equal((await state(root)).evidence.Atomicity.attempts, 1);
  assert.equal((await assess(root, input)).learningState.revision, 2);
});

test("legacy recorder uses the same assistance policy", async t => {
  const root = await fixture(t);
  const result = await recordCheckpointAssessment(root, { sessionId: "lesson", evidenceConcept: "Atomicity", nextStep: "Review", hintUsed: true }, { format: "free-recall", outcome: "accurate", response: "All writes", criteria: ["All writes together"], rationale: "Atomicity" });
  const evidence = result.evidence.Atomicity;
  assert.equal(evidence.consecutiveSuccesses, 0);
  assert.equal(evidence.lastSuccessfulRetrieval, undefined);
  assert.equal(evidence.dimensions.recall, "assisted");
  assert.equal(evidence.history.length, 1);
  assertPublic(result);
  assertPublic(await state(root));
});

test("bridge commits through the service before consuming a card", async t => {
  const root = await fixture(t);
  const bridge = spawn(process.execPath, [fileURLToPath(new URL("../src/bridge.mjs", import.meta.url)), "--workspace", root]);
  const replies = new Map();
  let stderr = "";
  bridge.stderr.on("data", bytes => { stderr += bytes; });
  const lines = readline.createInterface({ input: bridge.stdout });
  lines.on("line", line => {
    const message = JSON.parse(line);
    replies.get(message.id)?.resolve(message.result);
    replies.delete(message.id);
  });
  bridge.on("close", code => { for (const pending of replies.values()) pending.reject(new Error(`bridge exited ${code}: ${stderr}`)); });
  t.after(() => { lines.close(); bridge.kill(); });
  let id = 0;
  function call(name, args) {
    return new Promise((resolve, reject) => {
      replies.set(++id, { resolve, reject });
      bridge.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })}\n`);
    });
  }
  const framed = await call("loom_frame_checkpoint", { prompt: "Choose", choices: [{ key: "a", label: "A" }, { key: "b", label: "B" }], expected: "a", rationale: "A" });
  assert.equal(framed.isError, undefined);
  assert.equal("expected" in framed.structuredContent, false);
  const input = request(framed.structuredContent);
  assert.equal((await call("loom_assess_checkpoint", { ...input, nextStep: " " })).isError, true);
  const assessed = await call("loom_assess_checkpoint", input);
  assert.equal(assessed.isError, undefined, JSON.stringify(assessed));
  assert.equal(assessed.structuredContent.attemptId, "attempt-1");
  assertPublic(assessed.structuredContent);
  assertPublic(JSON.parse(assessed.content[0].text));
  assert.deepEqual(await call("loom_assess_checkpoint", input), assessed);
  assert.equal((await state(root)).evidence.Atomicity.attempts, 1);
});
