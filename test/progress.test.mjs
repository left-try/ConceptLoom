import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listDueReviews, loadLearningState, recordCheckpointAssessment, saveLearningState } from "../src/progress.mjs";

for (const [operation, schemaVersion] of [["patch", 3], ["patch", 2], ["migration", 1]]) {
  test(`${operation} schema ${schemaVersion} guards the bytes used to build state`, async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-read-race-"));
    const directory = join(root, ".concept-loom/sessions");
    await mkdir(directory, { recursive: true });
    const file = join(directory, "race.json");
    const original = { schemaVersion, sessionId: "race", topic: "TLS", goal: "Learn", phase: "build", nextStep: "Check", route: ["Original"], revision: 1 };
    const editedBytes = JSON.stringify({ ...original, route: ["External edit"], revision: 2 });
    await writeFile(file, JSON.stringify(original));
    const source = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
      const originalRead = fs.readFile; let changed = false;
      fs.readFile = async (...args) => { const bytes = await originalRead(...args); if(!changed && String(args[0]) === process.argv[2]) {changed = true; await fs.writeFile(process.argv[2], process.argv[3]);} return bytes; };
      syncBuiltinESMExports(); const {saveLearningState, loadLearningState} = await import(${JSON.stringify(new URL("../src/progress.mjs", import.meta.url).href)});
      try { if(process.argv[4] === 'migration') await loadLearningState(process.argv[1], {sessionId:'race'}); else await saveLearningState(process.argv[1], {sessionId:'race', topic:'TLS', goal:'Learn', phase:'build', nextStep:'Continue'}); console.log('ACCEPTED'); } catch(error) {console.log(error.code);} `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", source, root, file, editedBytes, operation], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "HASH_CONFLICT");
    assert.equal(await readFile(file, "utf8"), editedBytes);
    assert.deepEqual((await readdir(directory)).filter(name => name.includes(".bak")), []);
  });
}

test("patch preserves omitted arrays", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-patch-"));
  const original = await saveLearningState(root, { sessionId: "patch", topic: "TLS", goal: "Learn", phase: "build", route: ["Hello", "JA4"], secured: ["Hello"], gaps: ["JA4"], currentStep: "Hello", notebookPath: "notes.md", learnerContext: "Networking", nextStep: "Check", evidence: { Hello: { attempts: 2 } }, routeExtensions: [{ concept: "TCP" }] });
  const updated = await saveLearningState(root, { sessionId: "patch", topic: "TLS", goal: "Learn", phase: "build", nextStep: "Continue" });
  for (const field of ["route", "secured", "gaps", "evidence", "routeExtensions", "currentStep", "notebookPath", "learnerContext"]) assert.deepEqual(updated[field], original[field], field);
  assert.equal(updated.schemaVersion, 3);
  const sparse = await saveLearningState(root, { sessionId: "patch", nextStep: "Sparse patch" });
  assert.equal(sparse.goal, "Learn");
  assert.deepEqual(sparse.route, ["Hello", "JA4"]);
});

test("omitted routeExtensions preserve unknown fields and absent timestamps exactly", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-extension-preserve-"));
  const directory = join(root, ".concept-loom/sessions");
  await mkdir(directory, { recursive: true });
  const extensions = [{ concept: "TCP", dependsOn: ["IP"], futureTag: { source: "learner" } }, { concept: "DNS", addedAt: "2026-01-01T00:00:00.000Z", customEvidence: ["lesson-7"] }];
  await writeFile(join(directory, "extensions.json"), JSON.stringify({ schemaVersion: 3, sessionId: "extensions", topic: "TLS", goal: "Learn", phase: "build", nextStep: "Check", revision: 1, routeExtensions: extensions }));
  const patched = await saveLearningState(root, { sessionId: "extensions", nextStep: "Continue" });
  assert.deepEqual(patched.routeExtensions, extensions);
  const assessed = await recordCheckpointAssessment(root, { sessionId: "extensions", nextStep: "After assessment" }, { outcome: "accurate", selected: ["tls"] });
  assert.deepEqual(assessed.routeExtensions, extensions);
  const explicit = await saveLearningState(root, { sessionId: "extensions", routeExtensions: [{ concept: " TCP ", reason: " New prerequisite " }] });
  assert.equal(explicit.routeExtensions[0].concept, "TCP");
  assert.equal(explicit.routeExtensions[0].reason, "New prerequisite");
  assert.match(explicit.routeExtensions[0].addedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("stale revision changes nothing", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-conflict-"));
  const base = { sessionId: "conflict", topic: "TLS", goal: "Learn", phase: "build", route: ["Hello"], nextStep: "Check" };
  await saveLearningState(root, base);
  const file = join(root, ".concept-loom/sessions/conflict.json");
  const before = await readFile(file, "utf8");
  await assert.rejects(saveLearningState(root, { ...base, expectedRevision: 0, nextStep: "Stale" }), { code: "REVISION_CONFLICT" });
  assert.equal(await readFile(file, "utf8"), before);
  const updated = await saveLearningState(root, { ...base, expectedRevision: 1, nextStep: "Fresh" });
  assert.equal(updated.revision, 2);
});

test("snapshot validates required fields and only resets replaceable lists", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-snapshot-"));
  const base = { sessionId: "snapshot", topic: "TLS", goal: "Learn", phase: "build", route: ["Hello"], nextStep: "Check", evidence: { Hello: { attempts: 2 } }, learnerContext: "Network" };
  await saveLearningState(root, base);
  await assert.rejects(saveLearningState(root, { sessionId: "snapshot", updateMode: "snapshot", nextStep: "Incomplete" }), /topic/);
  await assert.rejects(saveLearningState(root, { ...base, updateMode: "unknown" }), /updateMode/);
  const snapshot = await saveLearningState(root, { sessionId: "snapshot", topic: "TLS", goal: "Learn", phase: "review", nextStep: "Review", updateMode: "snapshot" });
  assert.deepEqual(snapshot.route, []);
  assert.deepEqual(snapshot.evidence, { Hello: { attempts: 2 } });
  assert.equal(snapshot.learnerContext, "Network");
});

test("v1/v2 migration retains evidence", async () => {
  for (const schemaVersion of [1, 2]) {
    const root = await mkdtemp(join(tmpdir(), "loom-migration-"));
    const directory = join(root, ".concept-loom/sessions");
    await mkdir(directory, { recursive: true });
    const original = { schemaVersion, sessionId: "legacy", topic: "TLS", goal: "Learn", phase: "build", revision: 7, route: ["Hello", "JA4"], secured: ["Hello"], gaps: [], nextStep: "Resume", evidence: { Hello: { attempts: 3, dimensions: { recall: "demonstrated" } } }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" };
    const bytes = JSON.stringify(original, null, 2);
    await writeFile(join(directory, "legacy.json"), bytes);
    const { state } = await loadLearningState(root, { sessionId: "legacy" });
    assert.equal(state.schemaVersion, 3);
    assert.deepEqual(state.route, ["Hello", "JA4"]);
    assert.deepEqual(state.evidence, original.evidence);
    const backups = (await readdir(directory)).filter(name => name.includes(".bak"));
    assert.equal(backups.length, 1);
    assert.equal(await readFile(join(directory, backups[0]), "utf8"), bytes);
    const moduleUrl = new URL("../src/progress.mjs", import.meta.url).href;
    const restarted = spawnSync(process.execPath, ["--input-type=module", "-e", `import {loadLearningState} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(await loadLearningState(process.argv[1], {sessionId:'legacy'})));`, root], { encoding: "utf8" });
    assert.equal(restarted.status, 0, restarted.stderr);
    assert.deepEqual(JSON.parse(restarted.stdout).state, state);
  }
});

test("persists and restores a learning session", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-progress-"));
  await saveLearningState(root, {
    sessionId: "ja4-basics",
    topic: "JA4",
    goal: "Understand JA4 fingerprints",
    phase: "build",
    route: ["TLS ClientHello", "JA4 components"],
    secured: ["TLS ClientHello"],
    gaps: [],
    currentStep: "TLS ClientHello",
    nextStep: "Explain JA4 components",
  });

  const restored = await loadLearningState(root, { sessionId: "ja4-basics" });
  assert.equal(restored.state.nextStep, "Explain JA4 components");
  assert.deepEqual(restored.state.secured, ["TLS ClientHello"]);
  const diskState = JSON.parse(await readFile(join(root, ".concept-loom/sessions/ja4-basics.json"), "utf8"));
  assert.equal(diskState.revision, 1);
});

test("returns the latest state and session summaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-progress-"));
  await saveLearningState(root, {
    sessionId: "first",
    topic: "First",
    goal: "Learn first",
    phase: "locate",
    nextStep: "Probe",
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2));
  await saveLearningState(root, {
    sessionId: "second",
    topic: "Second",
    goal: "Learn second",
    phase: "weave",
    nextStep: "Approve route",
  });

  const restored = await loadLearningState(root);
  assert.equal(restored.state.sessionId, "second");
  assert.equal(restored.sessions.length, 2);
});

test("updates a session atomically and increments its revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-progress-"));
  const base = {
    sessionId: "topic",
    topic: "Topic",
    goal: "Learn topic",
    phase: "build",
    nextStep: "Step one",
  };
  await saveLearningState(root, base);
  const updated = await saveLearningState(root, { ...base, secured: ["Step one"], nextStep: "Step two" });
  assert.equal(updated.revision, 2);
  assert.deepEqual(updated.secured, ["Step one"]);
});

test("records checkpoint outcome before the lesson continues", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-progress-"));
  await saveLearningState(root, {
    sessionId: "ja4",
    topic: "JA4",
    goal: "Understand JA4",
    phase: "build",
    route: ["TLS", "JA4"],
    nextStep: "Check TLS understanding",
  });

  const updated = await recordCheckpointAssessment(root, {
    sessionId: "ja4",
    currentStep: "TLS",
    nextStep: "Explain JA4 fields",
    securedConnection: "TLS ClientHello structure",
  }, {
    outcome: "accurate",
    selected: ["client-hello"],
  });

  assert.equal(updated.nextStep, "Explain JA4 fields");
  assert.deepEqual(updated.secured, ["TLS ClientHello structure"]);
  assert.equal(updated.lastCheckpoint.outcome, "accurate");
  assert.equal(updated.evidence["TLS ClientHello structure"].dimensions.recognition, "demonstrated");
  assert.equal(updated.evidence["TLS ClientHello structure"].attempts, 1);
  assert.equal(updated.revision, 2);
});

test("tracks transfer evidence, confidence, hints, and delayed review", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-progress-"));
  await saveLearningState(root, {
    sessionId: "transactions",
    topic: "Transactions",
    goal: "Choose isolation levels",
    phase: "build",
    mode: "practice",
    route: ["Atomicity", "Isolation"],
    routeExtensions: [{ concept: "Write skew", dependsOn: ["Isolation"], reason: "Found during practice" }],
    nextStep: "Try a transfer problem",
  });

  const updated = await recordCheckpointAssessment(root, {
    sessionId: "transactions",
    currentStep: "Isolation",
    nextStep: "Review tomorrow",
    evidenceConcept: "Isolation trade-offs",
    hintUsed: false,
  }, {
    format: "transfer",
    outcome: "accurate",
    response: "Use serializable because the invariant spans rows.",
    confidence: 85,
    calibration: "well-calibrated",
  });

  const evidence = updated.evidence["Isolation trade-offs"];
  assert.equal(updated.mode, "practice");
  assert.equal(updated.routeExtensions[0].concept, "Write skew");
  assert.equal(evidence.dimensions.transfer, "demonstrated");
  assert.equal(evidence.transferPassed, true);
  assert.equal(evidence.lastConfidence, 85);
  assert.match(evidence.reviewAfter, /^\d{4}-\d{2}-\d{2}T/);

  const reviews = await listDueReviews(root, { now: "2100-01-01T00:00:00.000Z" });
  assert.equal(reviews.due.length, 1);
  assert.equal(reviews.due[0].concept, "Isolation trade-offs");
});
