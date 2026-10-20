import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitTransaction, recoverTransactions } from "../src/storage/transactions.mjs";
import { resolveContainedPath } from "../src/storage/paths.mjs";

test("transaction commits JSON writes and checks an expected revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-storage-"));
  await mkdir(join(root, "state"));
  await writeFile(join(root, "state", "one.json"), JSON.stringify({ revision: 2 }), "utf8");
  const result = await commitTransaction(root, {
    id: "tx-1", checks: [{ path: "state/one.json", expectedRevision: 2 }],
    writes: [{ path: "state/one.json", value: { revision: 3 }, encoding: "json" }],
  });
  assert.equal(result.revisions["state/one.json"], 3);
  assert.deepEqual(JSON.parse(await readFile(join(root, "state/one.json"), "utf8")), { revision: 3 });
});

test("stale revision leaves every target unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-storage-"));
  await mkdir(join(root, "state"));
  const path = join(root, "state", "one.json");
  await writeFile(path, JSON.stringify({ revision: 2 }), "utf8");
  await assert.rejects(commitTransaction(root, {
    id: "tx-stale", checks: [{ path: "state/one.json", expectedRevision: 1 }],
    writes: [{ path: "state/one.json", value: { revision: 3 }, encoding: "json" }],
  }), { code: "REVISION_CONFLICT" });
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { revision: 2 });
});

test("contained paths reject traversal and symlink escapes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "loom-storage-"));
  await assert.rejects(resolveContainedPath(root, "../escape"), { code: "OUTSIDE_WORKSPACE" });
  const outside = await mkdtemp(join(tmpdir(), "loom-outside-"));
  try {
    await symlink(outside, join(root, "linked"), "junction");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) return t.skip(`junction unavailable: ${error.code}`);
    throw error;
  }
  await assert.rejects(resolveContainedPath(root, "linked/file.md"), { code: "OUTSIDE_WORKSPACE" });
});

test("transaction recovery reports an empty clean journal", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-storage-"));
  assert.deepEqual(await recoverTransactions(root), []);
});

test("replays a prepared journal after an interrupted write", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-storage-"));
  const tx = join(root, ".concept-loom", "transactions", "interrupted");
  await mkdir(tx, { recursive: true });
  const content = Buffer.from('{"revision":7}\n').toString("base64");
  await writeFile(join(tx, "journal.json"), JSON.stringify({
    id: "interrupted", status: "prepared", writes: [{ path: "state/recovered.json", encoding: "json", content }], revisions: { "state/recovered.json": 7 },
  }));
  assert.deepEqual(await recoverTransactions(root), [{ id: "interrupted", recovered: true }]);
  assert.equal(JSON.parse(await readFile(join(root, "state", "recovered.json"), "utf8")).revision, 7);
});

test("separate processes cannot both commit the same source revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-storage-"));
  await mkdir(join(root, "state"));
  await writeFile(join(root, "state", "shared.json"), JSON.stringify({ revision: 1 }));
  const moduleUrl = new URL("../src/storage/transactions.mjs", import.meta.url).href;
  const code = `import { commitTransaction } from ${JSON.stringify(moduleUrl)}; const root=process.argv[1]; const value=Number(process.argv[2]); try { await commitTransaction(root,{id:'writer-'+value,checks:[{path:'state/shared.json',expectedRevision:1}],writes:[{path:'state/shared.json',encoding:'json',value:{revision:2,writer:value}}]}); process.exit(0); } catch (e) { process.exit(e.code==='REVISION_CONFLICT'?3:4); }`;
  const run = (value) => new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, root, String(value)], { stdio: "ignore" });
    child.once("error", rejectRun);
    child.once("exit", (status) => resolveRun(status));
  });
  const statuses = await Promise.all([run(1), run(2)]);
  assert.deepEqual([...statuses].sort(), [0, 3]);
  assert.equal(JSON.parse(await readFile(join(root, "state", "shared.json"), "utf8")).revision, 2);
});
