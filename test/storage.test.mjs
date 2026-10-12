import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, hostname } from "node:os";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { beginNotebook, addNotebookEntry } from "../src/notebook.mjs";

const transactionsUrl = new URL("../src/storage/transactions.mjs", import.meta.url).href;
const progressUrl = new URL("../src/progress.mjs", import.meta.url).href;
const storage = () => import(transactionsUrl);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "loom-storage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function child(source, args, onStdout = () => {}) {
  return new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, ["--input-type=module", "-e", source, ...args]);
    let stdout = "", stderr = "";
    process.stdout.on("data", data => { stdout += data; onStdout(String(data)); });
    process.stderr.on("data", data => { stderr += data; });
    process.on("error", reject);
    process.on("close", code => resolve({ code, stdout, stderr }));
  });
}

test("two processes serialize", async t => {
  const root = await fixture(t);
  const { saveLearningState } = await import(progressUrl);
  await saveLearningState(root, { sessionId: "race", topic: "Race", goal: "Serialize", phase: "build", nextStep: "Start" });
  const source = `import { saveLearningState } from ${JSON.stringify(progressUrl)};
    try { const state = await saveLearningState(process.argv[1], { sessionId: 'race', expectedRevision: 1, topic: 'Race', goal: 'Serialize', phase: 'build', nextStep: process.argv[2] }); console.log(state.revision); }
    catch (error) { console.log(error.code); process.exitCode = 2; }`;
  const results = await Promise.all([child(source, [root, "Left"]), child(source, [root, "Right"])]);
  assert.deepEqual(results.map(result => result.code).sort(), [0, 2]);
  assert.equal(results.find(result => result.code === 2).stdout.trim(), "REVISION_CONFLICT");
  const state = JSON.parse(await readFile(join(root, ".concept-loom/sessions/race.json"), "utf8"));
  assert.equal(state.revision, 2);
  assert.ok(["Left", "Right"].includes(state.nextStep));
});

test("recovers interrupted transaction", async t => {
  const root = await fixture(t);
  const transaction = { id: "interrupted", checks: [], writes: [
    { path: "state.json", value: { revision: 2, evidence: "TLS" }, encoding: "json" },
    { path: "evidence.json", value: { revision: 2, concept: "TLS" }, encoding: "json" },
  ], events: [{ eventId: "interrupted-event" }] };
  const source = `import fs from 'node:fs/promises';
    const original = fs.rename; fs.rename = async (...args) => { await original(...args); if (args[1].endsWith('state.json')) process.exit(73); };
    const { commitTransaction } = await import(${JSON.stringify(transactionsUrl)});
    await commitTransaction(process.argv[1], JSON.parse(process.argv[2]));`;
  const result = await child(source, [root, JSON.stringify(transaction)]);
  assert.equal(result.code, 73, result.stderr);
  await assert.rejects(readFile(join(root, "evidence.json")), { code: "ENOENT" });
  const { recoverTransactions, commitTransaction } = await storage();
  const diagnostics = await recoverTransactions(root);
  assert.ok(diagnostics.some(entry => entry.transactionId === "interrupted" && entry.code === "TRANSACTION_RECOVERED"));
  assert.equal(JSON.parse(await readFile(join(root, "state.json"))).revision, 2);
  assert.equal(JSON.parse(await readFile(join(root, "evidence.json"))).concept, "TLS");
  const before = await readFile(join(root, "state.json"), "utf8");
  const replay = await commitTransaction(root, transaction);
  assert.equal(replay.id, "interrupted");
  assert.equal(await readFile(join(root, "state.json"), "utf8"), before);
  assert.deepEqual(await recoverTransactions(root), []);
  await assert.rejects(commitTransaction(root, { ...transaction, writes: [] }), { code: "TRANSACTION_CONFLICT" });
});

test("hash guard checks raw bytes and null requires absence", async t => {
  const root = await fixture(t);
  const { commitTransaction } = await storage();
  await writeFile(join(root, "note.md"), "original\r\n");
  const hash = createHash("sha256").update("original\r\n").digest("hex");
  await assert.rejects(commitTransaction(root, { checks: [{ path: "note.md", expectedHash: null }], writes: [{ path: "note.md", value: "bad", encoding: "utf8" }] }), { code: "HASH_CONFLICT" });
  assert.equal(await readFile(join(root, "note.md"), "utf8"), "original\r\n");
  await commitTransaction(root, { checks: [{ path: "note.md", expectedHash: hash }], writes: [{ path: "note.md", value: "updated", encoding: "utf8" }] });
  await assert.rejects(commitTransaction(root, { checks: [{ path: "note.md", expectedHash: hash }], writes: [] }), { code: "HASH_CONFLICT" });
  await assert.rejects(commitTransaction(root, { checks: [{ path: "note.md", expectedRevision: null }], writes: [] }), { code: "REVISION_CONFLICT" });
});

test("rejects junction escape", async t => {
  const root = await fixture(t), outside = await fixture(t);
  try { await symlink(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir"); }
  catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip(`junction fixture unsupported: ${error.code}`);
    throw error;
  }
  const { resolveContainedPath } = await import("../src/storage/paths.mjs");
  await assert.rejects(resolveContainedPath(root, "escape/sub/note.md", { create: true }), { code: "OUTSIDE_WORKSPACE" });
  await assert.rejects(beginNotebook(root, { path: "escape/note.md" }), { code: "OUTSIDE_WORKSPACE" });
  await assert.rejects(addNotebookEntry(root, { path: "escape/note.md", kind: "insight", body: "No escape" }), { code: "OUTSIDE_WORKSPACE" });
  await assert.rejects(readFile(join(outside, "note.md")), { code: "ENOENT" });
  await assert.rejects(resolveContainedPath(root, "../outside"), { code: "OUTSIDE_WORKSPACE" });
  await assert.rejects(resolveContainedPath(root, join(root, "absolute.md")), { code: "OUTSIDE_WORKSPACE" });
  assert.equal(await resolveContainedPath(root, "nested/кириллица.md", { create: true }), join(root, "nested/кириллица.md"));
});

test("live lock times out without stealing and dead owner recovers", async t => {
  const root = await fixture(t);
  const directory = join(root, ".concept-loom/storage/lock");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "owner.json"), JSON.stringify({ pid: process.pid, hostname: hostname(), token: "live" }));
  const { withWorkspaceLock, commitTransaction } = await storage();
  await assert.rejects(withWorkspaceLock(root, async () => {}, { timeoutMs: 30 }), { code: "WORKSPACE_LOCKED" });
  assert.equal(JSON.parse(await readFile(join(directory, "owner.json"))).token, "live");
  const exited = await child("console.log(process.pid)", []);
  await writeFile(join(directory, "owner.json"), JSON.stringify({ pid: Number(exited.stdout.trim()), hostname: hostname(), token: "dead" }));
  await commitTransaction(root, { writes: [{ path: "alive.txt", value: "recovered", encoding: "utf8" }] });
  assert.equal(await readFile(join(root, "alive.txt"), "utf8"), "recovered");
});

test("concurrent notebook entries preserve both bodies", async t => {
  const root = await fixture(t);
  await beginNotebook(root, { path: "notes.md" });
  await Promise.all(["left", "right"].map(body => addNotebookEntry(root, { path: "notes.md", kind: "insight", body })));
  const note = await readFile(join(root, "notes.md"), "utf8");
  assert.match(note, /> left/);
  assert.match(note, /> right/);
});

test("dead lock contention never removes a newly acquired live owner", async t => {
  const root = await fixture(t);
  const directory = join(root, ".concept-loom/storage/lock");
  await mkdir(directory, { recursive: true });
  const dead = await child("console.log(process.pid)", []);
  await writeFile(join(directory, "owner.json"), JSON.stringify({ pid: Number(dead.stdout.trim()), hostname: hostname(), token: "dead-contention" }));
  const source = `import fs from 'node:fs/promises'; import {join} from 'node:path';
    if(process.argv[2] === 'pause') { const original = fs.rename; fs.rename = async (...args) => { if(args[1].endsWith('.stale')) { console.log('READY'); while(true) {try {await fs.readFile(join(process.argv[1], 'go')); break;} catch {} await new Promise(r => setTimeout(r, 5));} } return original(...args); }; }
    const {withWorkspaceLock} = await import(${JSON.stringify(transactionsUrl)});
    await withWorkspaceLock(process.argv[1], async () => { const file = join(process.argv[1], 'counter.txt'); let count = 0; try {count = Number(await fs.readFile(file, 'utf8'));} catch(error) {if(error.code !== 'ENOENT') throw error;} await new Promise(r => setTimeout(r, process.argv[2] === 'pause' ? 20 : 250)); await fs.writeFile(file, String(count + 1)); });`;
  let ready;
  const readiness = new Promise(resolve => { ready = resolve; });
  const first = child(source, [root, "pause"], data => { if (data.includes("READY")) ready(); });
  await readiness;
  const second = child(source, [root, "normal"]);
  await new Promise(resolve => setTimeout(resolve, 140));
  await writeFile(join(root, "go"), "go");
  const results = await Promise.all([first, second]);
  for (const result of results) assert.equal(result.code, 0, result.stderr);
  assert.equal(await readFile(join(root, "counter.txt"), "utf8"), "2");
});

test("malformed recovery journal fails visibly and cannot overwrite lock metadata", async t => {
  const root = await fixture(t);
  const directory = join(root, ".concept-loom/storage/transactions");
  await mkdir(directory, { recursive: true });
  const bytes = Buffer.from("corrupt owner");
  await writeFile(join(directory, "invalid.json"), JSON.stringify({ schemaVersion: 1, id: "invalid", status: "prepared", writes: [{ path: ".concept-loom/storage/lock/owner.json", data: bytes.toString("base64"), hash: createHash("sha256").update(bytes).digest("hex") }], events: [] }));
  const { recoverTransactions, commitTransaction } = await storage();
  const diagnostics = await recoverTransactions(root);
  assert.equal(diagnostics[0].code, "TRANSACTION_RECOVERY_FAILED");
  await assert.rejects(commitTransaction(root, { writes: [{ path: "never.txt", value: "no", encoding: "utf8" }] }), { code: "TRANSACTION_RECOVERY_FAILED" });
  await assert.rejects(readFile(join(root, "never.txt")), { code: "ENOENT" });
});
