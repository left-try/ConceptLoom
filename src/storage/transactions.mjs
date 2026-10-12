import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { hostname } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { resolveContainedPath } from "./paths.mjs";

const lockContext = new AsyncLocalStorage();
const storagePath = ".concept-loom/storage";
export const hashBytes = bytes => createHash("sha256").update(bytes).digest("hex");
function failure(code, message) { return Object.assign(new Error(`${code}: ${message}`), { code }); }
async function readOptional(path) {
  try { return await fs.readFile(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function durableWrite(path, bytes) {
  const handle = await fs.open(path, "wx");
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}
async function atomicWrite(path, bytes) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await durableWrite(temporary, bytes); await fs.rename(temporary, path); }
  finally { await fs.rm(temporary, { force: true }); }
}

async function renameLock(source, destination) {
  for (let attempt = 0; ; attempt++) {
    try { return await fs.rename(source, destination); }
    catch (error) {
      // Windows can briefly deny a directory rename while a waiter reads it.
      if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt === 20) throw error;
      await delay(15);
    }
  }
}

function ownerIsDead(owner) {
  if (owner?.hostname !== hostname() || !Number.isInteger(owner.pid) || owner.pid <= 0) return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (error) { return error.code === "ESRCH"; }
}

async function reclaimDeadLock(lock, originalBytes, candidate, owner) {
  let claim = join(lock, "reclaim.json");
  // An immutable, fully written hard link arbitrates reclamation. A crashed
  // reclaimer is superseded through its own token, never by deleting a live claim.
  for (let depth = 0; depth < 64; depth++) {
    try { await fs.link(candidate, claim); }
    catch (error) {
      if (error.code === "ENOENT") return false;
      if (error.code !== "EEXIST") throw error;
      const bytes = await readOptional(claim);
      let earlier;
      try { earlier = bytes && JSON.parse(bytes); } catch { return false; }
      if (!ownerIsDead(earlier) || typeof earlier.token !== "string" || !/^[a-z0-9_-]+$/i.test(earlier.token)) return false;
      claim = join(lock, `reclaim-${earlier.token}.json`);
      continue;
    }
    try {
      const current = await readOptional(join(lock, "owner.json"));
      if (!current?.equals(originalBytes)) return false;
      const stale = `${lock}.${randomUUID()}.stale`;
      await renameLock(lock, stale);
      await fs.rm(stale, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    } finally {
      const current = await readOptional(claim);
      if (current && JSON.parse(current).token === owner.token) await fs.rm(claim, { force: true });
    }
  }
  return false;
}

export async function withWorkspaceLock(root, operation, { timeoutMs = 10000 } = {}) {
  await fs.mkdir(resolve(root), { recursive: true });
  const canonicalRoot = await fs.realpath(resolve(root));
  if (lockContext.getStore()?.root === canonicalRoot) return operation();
  const lock = await resolveContainedPath(canonicalRoot, `${storagePath}/lock`, { create: true });
  const ownerPath = join(lock, "owner.json");
  const owner = { pid: process.pid, hostname: hostname(), token: randomUUID() };
  const candidate = join(dirname(lock), `${owner.token}.owner.tmp`);
  await durableWrite(candidate, JSON.stringify(owner));
  const deadline = Date.now() + timeoutMs;
  try {
    while (true) {
      try {
        await fs.mkdir(lock);
        try { await fs.link(candidate, ownerPath); }
        catch (error) { await fs.rm(lock, { recursive: true, force: true }); throw error; }
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const data = await readOptional(ownerPath);
        let existing;
        try { existing = data && JSON.parse(data); } catch { /* Incomplete metadata is never stolen by time alone. */ }
        if (ownerIsDead(existing) && await reclaimDeadLock(lock, data, candidate, owner)) continue;
        if (Date.now() >= deadline) throw failure("WORKSPACE_LOCKED", "workspace lock owner is live or cannot be verified");
        await delay(10);
      }
    }
    try { return await lockContext.run({ root: canonicalRoot }, operation); }
    finally {
      const data = await readOptional(ownerPath);
      if (data && JSON.parse(data).token === owner.token) await fs.rm(lock, { recursive: true, force: true });
    }
  } finally { await fs.rm(candidate, { force: true }); }
}

function validateId(id) {
  if (typeof id !== "string" || !/^[a-z0-9_-]{1,128}$/i.test(id)) throw failure("INVALID_TRANSACTION", "id must contain only letters, numbers, underscores and hyphens");
  return id;
}
async function journalDirectory(root) {
  const path = await resolveContainedPath(root, `${storagePath}/transactions/.placeholder`, { create: true });
  return dirname(path);
}
async function writeJournal(root, journal) {
  const directory = await journalDirectory(root);
  await atomicWrite(join(directory, `${validateId(journal.id)}.json`), `${JSON.stringify(journal, null, 2)}\n`);
}
async function applyJournal(root, journal) {
  if (journal.schemaVersion !== 1 || !Array.isArray(journal.writes) || !Array.isArray(journal.events)) throw failure("INVALID_JOURNAL", "malformed transaction journal");
  validateId(journal.id);
  // Validate every destination before changing any target file.
  for (const write of journal.writes) {
    const path = await resolveContainedPath(root, write.path);
    const canonicalRoot = await fs.realpath(resolve(root));
    const key = relative(canonicalRoot, path).split("\\").join("/").toLowerCase();
    if (!key || key === storagePath || key.startsWith(`${storagePath}/`)) throw failure("INVALID_JOURNAL", "reserved write path");
    if (hashBytes(Buffer.from(write.data, "base64")) !== write.hash) throw failure("INVALID_JOURNAL", "write checksum mismatch");
  }
  for (const write of journal.writes) {
    const destination = await resolveContainedPath(root, write.path, { create: true });
    const bytes = Buffer.from(write.data, "base64");
    const current = await readOptional(destination);
    if (current && hashBytes(current) === write.hash) continue;
    await atomicWrite(destination, bytes);
  }
  await writeJournal(root, { ...journal, status: "committed" });
}

async function recoverLocked(root) {
  const directory = await journalDirectory(root);
  const diagnostics = [];
  for (const name of (await fs.readdir(directory)).filter(name => name.endsWith(".json")).sort()) {
    let journal;
    try {
      journal = JSON.parse(await fs.readFile(await resolveContainedPath(root, `${storagePath}/transactions/${name}`), "utf8"));
      if (`${validateId(journal.id)}.json` !== name || !["prepared", "committed"].includes(journal.status)) throw failure("INVALID_JOURNAL", "invalid journal identity or status");
      if (journal.status === "committed") continue;
      await applyJournal(root, journal);
      diagnostics.push({ severity: "info", code: "TRANSACTION_RECOVERED", transactionId: journal.id });
    } catch (error) {
      diagnostics.push({ severity: "error", code: "TRANSACTION_RECOVERY_FAILED", transactionId: journal?.id ?? name, message: error.message });
    }
  }
  return diagnostics;
}
export async function recoverTransactions(root) {
  return withWorkspaceLock(root, () => recoverLocked(root));
}
export function assertRecovery(diagnostics) {
  const errors = diagnostics.filter(entry => entry.severity === "error");
  if (errors.length) throw failure("TRANSACTION_RECOVERY_FAILED", errors.map(entry => entry.message).join("; "));
}

export async function commitTransaction(root, { id = randomUUID(), checks = [], writes = [], events = [] } = {}) {
  validateId(id);
  if (!Array.isArray(checks) || !Array.isArray(writes) || !Array.isArray(events)) throw failure("INVALID_TRANSACTION", "checks, writes and events must be arrays");
  return withWorkspaceLock(root, async () => {
    assertRecovery(await recoverLocked(root));
    const directory = await journalDirectory(root);
    const fingerprint = hashBytes(JSON.stringify({ checks, writes, events }));
    const existing = await readOptional(join(directory, `${id}.json`));
    if (existing) {
      const journal = JSON.parse(existing);
      if (journal.fingerprint !== fingerprint) throw failure("TRANSACTION_CONFLICT", "transaction id was already used with different content");
      return { id, revisions: journal.revisions };
    }
    for (const check of checks) {
      const path = await resolveContainedPath(root, check.path);
      const bytes = await readOptional(path);
      if (Object.hasOwn(check, "expectedHash") && (bytes === null ? null : hashBytes(bytes)) !== check.expectedHash) throw failure("HASH_CONFLICT", check.path);
      if (Object.hasOwn(check, "expectedRevision")) {
        if (check.expectedRevision === null && bytes !== null) throw failure("REVISION_CONFLICT", check.path);
        const revision = bytes === null ? null : JSON.parse(bytes).revision;
        if (revision !== check.expectedRevision) throw failure("REVISION_CONFLICT", check.path);
      }
    }
    const prepared = [], revisions = {}, destinations = new Set();
    for (const write of writes) {
      const path = await resolveContainedPath(root, write.path);
      const relativePath = relative(await fs.realpath(resolve(root)), path).split("\\").join("/");
      const key = process.platform === "win32" ? relativePath.toLowerCase() : relativePath;
      if (!relativePath || key === storagePath || key.startsWith(`${storagePath}/`) || destinations.has(key)) throw failure("INVALID_TRANSACTION", "duplicate or reserved write path");
      destinations.add(key);
      if (write.encoding !== "json" && write.encoding !== "utf8") throw failure("INVALID_TRANSACTION", "encoding must be json or utf8");
      if (write.encoding === "utf8" && typeof write.value !== "string") throw failure("INVALID_TRANSACTION", "utf8 value must be a string");
      if (write.encoding === "json" && (!write.value || typeof write.value !== "object" || Array.isArray(write.value))) throw failure("INVALID_TRANSACTION", "json value must be an object");
      const bytes = Buffer.from(write.encoding === "json" ? `${JSON.stringify(write.value, null, 2)}\n` : write.value, "utf8");
      prepared.push({ path: relativePath, data: bytes.toString("base64"), hash: hashBytes(bytes) });
      if (write.encoding === "json" && Object.hasOwn(write.value, "revision")) revisions[write.path] = write.value.revision;
    }
    const journal = { schemaVersion: 1, id, fingerprint, status: "prepared", writes: prepared, events, revisions };
    await writeJournal(root, journal);
    await applyJournal(root, journal);
    return { id, revisions };
  });
}
