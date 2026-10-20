import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveContainedPath } from "./paths.mjs";

const STORE = ".concept-loom/transactions";
const LOCK = ".concept-loom/transaction.lock";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

async function acquire(root) {
  const lockPath = await resolveContainedPath(root, LOCK, { create: true });
  const deadline = Date.now() + 15000;
  while (true) {
    try {
      await mkdir(lockPath);
      await writeFile(join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      return async () => rm(lockPath, { recursive: true, force: true });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = await readJson(join(lockPath, "owner.json"));
      if (owner && !processAlive(owner.pid) && Date.now() - owner.startedAt > 1000) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) {
        const timeout = new Error("timed out waiting for workspace transaction lock");
        timeout.code = "LOCK_TIMEOUT";
        throw timeout;
      }
      await sleep(10 + Math.floor(Math.random() * 20));
    }
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

async function readBytes(path) {
  try { return await readFile(path); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

async function perform(root, record) {
  for (let index = 0; index < record.writes.length; index += 1) {
    const write = record.writes[index];
    const target = await resolveContainedPath(root, write.path, { create: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, Buffer.from(write.content, "base64"));
    await rename(temporary, target);
  }
  await writeFile(join(record.directory, "committed"), "ok");
}

async function recoverUnlocked(root) {
  const directory = await resolveContainedPath(root, STORE, { create: true });
  await mkdir(directory, { recursive: true });
  const reports = [];
  for (const name of await readdir(directory)) {
    const transactionDirectory = join(directory, name);
    const journalPath = join(transactionDirectory, "journal.json");
    const journal = await readJson(journalPath);
    if (!journal) continue;
    if (journal.status === "prepared") {
      await perform(root, { ...journal, directory: transactionDirectory });
      reports.push({ id: journal.id, recovered: true });
    } else if (journal.status === "committed") {
      reports.push({ id: journal.id, recovered: false });
    }
  }
  return reports;
}

export async function recoverTransactions(root) {
  const release = await acquire(root);
  try { return await recoverUnlocked(root); }
  finally { await release(); }
}

export async function commitTransaction(root, { id = randomUUID(), checks = [], writes = [], events = [] } = {}) {
  if (!Array.isArray(writes) || writes.length === 0) throw new Error("transaction requires at least one write");
  const release = await acquire(root);
  try {
    await recoverUnlocked(root);
    const txRoot = await resolveContainedPath(root, STORE, { create: true });
    await mkdir(txRoot, { recursive: true });
    for (const name of await readdir(txRoot)) {
      const existing = await readJson(join(txRoot, name, "journal.json"));
      if (existing?.id === id && existing.status === "committed") return { id, revisions: existing.revisions ?? {} };
    }
    const normalizedChecks = await Promise.all(checks.map(async (check) => ({
      ...check,
      absolutePath: await resolveContainedPath(root, check.path),
    })));
    for (const check of normalizedChecks) {
      const bytes = await readBytes(check.absolutePath);
      if ("expectedHash" in check && (bytes === null ? null : hash(bytes)) !== check.expectedHash) {
        const error = new Error(`content conflict for ${check.path}`); error.code = "CONTENT_CONFLICT"; throw error;
      }
      if ("expectedRevision" in check) {
        const current = bytes === null ? null : JSON.parse(bytes.toString("utf8"));
        if ((current?.revision ?? null) !== check.expectedRevision) {
          const error = new Error(`revision conflict for ${check.path}`); error.code = "REVISION_CONFLICT"; throw error;
        }
      }
    }
    const transactionDirectory = join(txRoot, `${Date.now()}-${id}`);
    await mkdir(transactionDirectory, { recursive: true });
    const revisions = {};
    for (const [index, write] of writes.entries()) {
    await resolveContainedPath(root, write.path);
      const bytes = write.encoding === "json"
        ? Buffer.from(`${JSON.stringify(write.value, null, 2)}\n`, "utf8")
        : Buffer.from(String(write.value), "utf8");
      writes[index] = { ...write, content: bytes.toString("base64") };
      if (write.encoding === "json" && write.value && typeof write.value === "object" && Number.isInteger(write.value.revision)) {
        revisions[write.path] = write.value.revision;
      }
    }
    const journal = { id, status: "prepared", writes: writes.map(({ path, encoding, content }) => ({ path, encoding, content })), events, revisions };
    await writeFile(join(transactionDirectory, "journal.json"), JSON.stringify(journal, null, 2));
    await perform(root, { ...journal, directory: transactionDirectory });
    journal.status = "committed";
    await writeFile(join(transactionDirectory, "journal.json"), JSON.stringify(journal, null, 2));
    return { id, revisions };
  } finally { await release(); }
}
