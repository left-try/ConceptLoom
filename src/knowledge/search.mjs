import { indexKnowledge } from "./index.mjs";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolveContainedPath } from "../storage/paths.mjs";

const tokenize = text => String(text).normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

export async function searchKnowledge(root, { query, limit = 20, cursor, scope = "knowledge" } = {}) {
  if (typeof query !== "string" || !query.trim()) throw new Error("query must not be empty");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("limit must be between 1 and 200");
  if (!["knowledge", "personal", "all"].includes(scope)) throw new Error("scope must be knowledge, personal, or all");
  const index = await indexKnowledge(root, { includePersonal: scope !== "knowledge" });
  let sourceCatalog = { revision: 0, sources: {} };
  try { sourceCatalog = JSON.parse(await fs.readFile(await resolveContainedPath(root, ".concept-loom/sources/catalog.json"), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const revision = createHash("sha256").update(`${index.revision}:${sourceCatalog.revision ?? 0}`).digest("hex").slice(0, 24);
  const terms = [...new Set(tokenize(query))];
  let offset = 0;
  if (cursor) {
    let decoded;
    try { decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); } catch { throw new Error("invalid cursor"); }
    if (decoded.revision !== revision || decoded.query !== query.normalize("NFKC").toLocaleLowerCase() || decoded.scope !== scope) throw new Error("stale cursor: index revision or query changed");
    offset = decoded.offset;
  }
  const searchable = [...index.nodes];
  for (const source of Object.values(sourceCatalog.sources ?? {})) {
    const version = [...(source.versions ?? [])].reverse().find(item => item.contentHash === source.currentContentHash);
    if (!version?.assetPath || !version.contentHash || !["full", "partial"].includes(version.coverage)) continue;
    const representation = version.receipt?.representation ?? source.receipt?.representation;
    if (!["raw", "extracted"].includes(representation)) continue;
    const assetPath = await resolveContainedPath(root, `vault/Knowledge/${version.assetPath}`);
    const body = await fs.readFile(assetPath, "utf8");
    searchable.push({ id: `source:${source.uid}`, uid: source.uid, path: `sources/${source.uid}/${version.contentHash}`, title: source.title, aliases: [], body, bodyHash: version.contentHash, scope: "knowledge", source: true });
  }
  const ranked = searchable.filter(node => scope === "all" || node.scope === scope).map(node => {
    const title = tokenize(node.title), aliases = tokenize((node.aliases ?? []).join(" ")), body = tokenize(node.body);
    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += 5;
      if (aliases.includes(term)) score += 4;
      score += body.filter(word => word === term).length;
    }
    return { node, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.node.path.localeCompare(b.node.path));
  const hits = ranked.slice(offset, offset + limit).map(({ node, score }) => {
    const text = String(node.body ?? "").replace(/\s+/g, " ").trim();
    const normalized = text.toLocaleLowerCase();
    const at = Math.max(0, terms.map(term => normalized.indexOf(term)).filter(index => index >= 0).sort((a, b) => a - b)[0] ?? 0);
    return { id: node.id, uid: node.uid, path: node.path, title: node.title, excerpt: text.slice(Math.max(0, at - 80), Math.min(text.length, at + 180)), score, scope: node.scope };
  });
  const nextOffset = offset + hits.length;
  const nextCursor = nextOffset < ranked.length ? Buffer.from(JSON.stringify({ revision, query: query.normalize("NFKC").toLocaleLowerCase(), scope, offset: nextOffset })).toString("base64url") : undefined;
  return { revision, hits, ...(nextCursor ? { nextCursor } : {}) };
}
