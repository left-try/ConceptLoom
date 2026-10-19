import fs from "node:fs/promises";
import { join, relative } from "node:path";
import { parseKnowledge, serializeKnowledge } from "./format.mjs";
import { resolveContainedPath } from "../storage/paths.mjs";
import { commitTransaction, hashBytes } from "../storage/transactions.mjs";

const marker = id => {
  if (typeof id !== "string" || !/^[a-z0-9_-]{1,80}$/i.test(id)) throw new Error("generated block id must be a path-safe slug");
  return { start: `<!-- conceptloom:generated:${id}:start -->`, end: `<!-- conceptloom:generated:${id}:end -->` };
};

export async function updateKnowledge(root, { path, expectedHash, metadataPatch = {}, blockId, generatedBody } = {}) {
  if (typeof path !== "string" || path.startsWith("/") || path.split(/[\\/]/).includes("..")) throw new Error("Knowledge update path must stay inside the bundle");
  const bundleRoot = await resolveContainedPath(root, "vault/Knowledge");
  const destination = await resolveContainedPath(bundleRoot, path);
  const workspacePath = relative(root, destination).split("\\").join("/");
  const existing = await fs.readFile(destination);
  const currentHash = hashBytes(existing);
  if (currentHash !== expectedHash) throw Object.assign(new Error(`HASH_CONFLICT: expected ${expectedHash}, found ${currentHash}`), { code: "HASH_CONFLICT" });
  const source = existing.toString("utf8");
  const parsed = parseKnowledge(source, { path, bundleRoot });
  if (parsed.document.errors.length || parsed.diagnostics.some(item => item.code === "OKF_DUPLICATE_KEY" || item.code === "OKF_INVALID_YAML")) throw new Error("Cannot update invalid YAML frontmatter");
  let body = parsed.body;
  if (blockId !== undefined) {
    const marks = marker(blockId);
    const starts = body.split(marks.start).length - 1, ends = body.split(marks.end).length - 1;
    if (starts > 1 || ends > 1 || starts !== ends) throw new Error("Duplicate, incomplete, or mismatched generated block markers");
    const block = `${marks.start}\n${String(generatedBody ?? "")}\n${marks.end}`;
    if (starts === 1) {
      const expression = new RegExp(`${marks.start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${marks.end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
      body = body.replace(expression, block);
    } else body = `${body.replace(/\s*$/, "\n\n")}${block}\n`;
  } else if (generatedBody !== undefined) throw new Error("generatedBody requires a blockId");
  const next = serializeKnowledge(parsed, { metadataPatch, body });
  const result = await commitTransaction(root, {
    checks: [{ path: workspacePath, expectedHash: currentHash }],
    writes: [{ path: workspacePath, encoding: "utf8", value: next }],
  });
  return { path: workspacePath, hash: hashBytes(Buffer.from(next)), transactionId: result.id };
}
