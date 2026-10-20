import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { commitTransaction } from "../storage/transactions.mjs";
import { resolveContainedPath } from "../storage/paths.mjs";

const digest = (text) => createHash("sha256").update(text).digest("hex");
export async function updateKnowledge(root, { path, expectedHash, metadataPatch = {}, blockId, generatedBody }) {
  if (!path || path.startsWith("/") || path.includes("..")) throw new Error("knowledge path must remain inside the vault");
  if (metadataPatch && Object.keys(metadataPatch).length) throw new Error("metadata changes require a parsed YAML edit proposal");
  const workspaceRelative = join("vault", "Knowledge", path).replaceAll("\\", "/");
  const absolute = await resolveContainedPath(root, workspaceRelative);
  const original = await readFile(absolute, "utf8");
  if (digest(original) !== expectedHash) { const error = new Error("knowledge note changed since it was read"); error.code = "CONTENT_CONFLICT"; throw error; }
  let updated = original;
  if (blockId) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(blockId)) throw new Error("generated block id is invalid");
    const start = "<!-- conceptloom:generated:" + blockId + ":start -->";
    const end = "<!-- conceptloom:generated:" + blockId + ":end -->";
    const startCount = original.split(start).length - 1;
    const endCount = original.split(end).length - 1;
    if (startCount > 1 || endCount > 1 || startCount !== endCount) throw new Error("duplicate or malformed generated block markers");
    const body = String(generatedBody ?? "").trim();
    if (startCount === 1) updated = original.slice(0, original.indexOf(start) + start.length) + "\n" + body + "\n" + original.slice(original.indexOf(end));
    else updated = original.trimEnd() + "\n\n" + start + "\n" + body + "\n" + end + "\n";
  }
  await commitTransaction(root, { id: `knowledge-update-${digest(updated)}`, checks: [{ path: workspaceRelative, expectedHash }], writes: [{ path: workspaceRelative, value: updated, encoding: "utf8" }] });
  return { hash: digest(updated), diagnostics: [] };
}
