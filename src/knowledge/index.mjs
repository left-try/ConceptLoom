import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { dirname, posix } from "node:path";
import { createHash } from "node:crypto";

const rootIndex = "---\nokf_version: \"0.2\"\n---\n# Knowledge\n\nConcept Loom knowledge vault.\n";
const logText = "# Log\n";
const hash = (text) => createHash("sha256").update(text).digest("hex");

export async function initializeKnowledge(root) {
  const bundleRoot = join(root, "vault"); const vaultRoot = join(bundleRoot, "Knowledge");
  await mkdir(vaultRoot, { recursive: true });
  for (const [path, content] of [[join(vaultRoot, "index.md"), rootIndex], [join(vaultRoot, "log.md"), logText], [join(vaultRoot, "Personal"), ""]]) {
    if (path.endsWith("Personal")) await mkdir(path, { recursive: true });
    else { try { await readFile(path); } catch (error) { if (error.code !== "ENOENT") throw error; await writeFile(path, content); } }
  }
  return { bundleRoot, vaultRoot };
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  let nested = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (/^\s/.test(line) && nested) { const child = line.match(/^\s+([\w-]+):\s*(.*)$/); if (child) meta[nested][child[1]] = parseScalar(child[2]); continue; }
    const field = line.match(/^([\w-]+):\s*(.*)$/); if (!field) continue;
    if (field[2] === "") { meta[field[1]] = {}; nested = field[1]; }
    else { nested = null; meta[field[1]] = parseScalar(field[2]); }
  }
  return { meta, body: text.slice(match[0].length) };
}
function parseScalar(value) {
  const text = value.trim();
  if (!text) return "";
  try { return JSON.parse(text); } catch { return text.replace(/^['"]|['"]$/g, ""); }
}

async function filesUnder(directory) {
  let result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result = result.concat(await filesUnder(path));
    else if (entry.isFile() && path.endsWith(".md")) result.push(path);
  }
  return result;
}

export async function indexKnowledge(root) {
  const { vaultRoot } = await initializeKnowledge(root);
  const nodes = [];
  for (const path of (await filesUnder(vaultRoot)).sort()) {
    if (["index.md", "log.md"].includes(relative(vaultRoot, path).replaceAll("\\", "/"))) continue;
    const text = await readFile(path, "utf8"); const { meta, body } = parseFrontmatter(text);
    const relPath = relative(vaultRoot, path).replaceAll("\\", "/");
    const asset = relPath.match(/^assets\/([a-z0-9_-]+)\/([a-f0-9]{32,64})\.md$/i);
    const uid = asset ? `fragment-${asset[1]}-${asset[2].slice(0, 16)}` : meta.conceptloom?.uid ?? meta.uid;
    nodes.push({ uid, path: relPath, type: asset ? "Source Fragment" : meta.type ?? null, title: meta.title ?? (asset ? `Source excerpt ${asset[1]}` : relPath.replace(/\.md$/, "")), aliases: meta.aliases ?? [], body, bodyHash: hash(text) });
  }
  const byUid = new Map(nodes.filter((node) => node.uid).map((node) => [node.uid, node]));
  const edges = []; const diagnostics = [];
  for (const node of nodes) {
    const visibleBody = node.body.replace(/^```[\s\S]*?^```\s*$/gm, "");
    const refs = [
      ...[...visibleBody.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => ({ target: match[1].split("|")[0], syntax: "wikilink", offset: match.index })),
      ...[...visibleBody.matchAll(/(?<!!)\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)].map((match) => ({ target: match[1], syntax: "markdown", offset: match.index })),
    ].sort((left, right) => left.offset - right.offset);
    for (const ref of refs) {
      let target;
      try { target = decodeURIComponent(ref.target); } catch { diagnostics.push({ code: "INVALID_LINK_ENCODING", path: node.path, target: ref.target }); continue; }
      if (/^(?:[a-z]+:|\/\/|#)/i.test(target)) continue;
      const [rawPath, anchor] = target.split("#", 2);
      const name = rawPath.replace(/\\/g, "/");
      const candidates = ref.syntax === "markdown"
        ? (() => {
          const resolvedPath = posix.normalize(posix.join(dirname(node.path), name));
          const withExtension = /\.md$/i.test(resolvedPath) ? resolvedPath : `${resolvedPath}.md`;
          return nodes.filter((item) => item.path.toLocaleLowerCase() === withExtension.toLocaleLowerCase());
        })()
        : nodes.filter((item) => item.path.replace(/\.md$/, "") === name || item.uid === name || item.title === name || (item.aliases ?? []).includes(name));
      const resolved = candidates.length === 1 ? candidates[0] : byUid.get(name);
      if (resolved) edges.push({ from: node.uid ?? node.path, to: resolved.uid ?? resolved.path, kind: "links-to", locator: { path: node.path, offset: ref.offset, anchor: anchor || undefined } });
      else if (candidates.length > 1) diagnostics.push({ code: ref.syntax === "wikilink" ? "AMBIGUOUS_WIKILINK" : "AMBIGUOUS_MARKDOWN_LINK", path: node.path, target: name });
    }
  }
  const revision = hash(nodes.map(({ path, bodyHash }) => `${path}:${bodyHash}`).join("\n"));
  await mkdir(join(root, ".concept-loom", "indexes"), { recursive: true });
  await writeFile(join(root, ".concept-loom", "indexes", "knowledge.json"), JSON.stringify({ revision, nodes, edges, diagnostics }, null, 2));
  return { revision, nodes, edges, diagnostics };
}

async function readIndex(root, options) { return indexKnowledge(root, options); }

export async function getKnowledgeNode(root, { uid, path }) {
  const index = await readIndex(root);
  const node = index.nodes.find((item) => (uid && item.uid === uid) || (path && item.path === path));
  if (!node) throw new Error(`knowledge node '${uid ?? path}' was not found`);
  return node;
}

export async function searchKnowledge(root, { query, limit = 10, cursor, scope = "knowledge" }) {
  if (typeof query !== "string" || !query.trim()) throw new Error("query is required");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be between 1 and 100");
  if (!new Set(["knowledge", "personal", "all"]).has(scope)) throw new Error("scope must be knowledge, personal, or all");
  const index = await readIndex(root);
  if (cursor && cursor.revision !== index.revision) throw Object.assign(new Error("knowledge index changed; restart search"), { code: "STALE_CURSOR" });
  const terms = [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])];
  const allowed = index.nodes.filter((node) => scope === "all" || (scope === "personal") === node.path.startsWith("Personal/"));
  const hits = allowed.map((node) => {
    const text = `${node.title} ${(node.aliases ?? []).join(" ")} ${node.body}`.toLocaleLowerCase();
    const score = terms.reduce((total, term) => total + (text.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gu"))?.length ?? 0), 0);
    return { uid: node.uid, path: node.path, title: node.title, excerpt: node.body.trim().replace(/\s+/g, " ").slice(0, 320), score };
  }).filter((hit) => hit.score > 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const offset = cursor?.offset ?? 0;
  return { hits: hits.slice(offset, offset + limit), nextCursor: offset + limit < hits.length ? { revision: index.revision, offset: offset + limit } : undefined };
}

export async function getNeighborhood(root, { uid, depth = 1, limit = 50 }) {
  if (!Number.isInteger(depth) || depth < 0 || depth > 3) throw new Error("depth must be between 0 and 3");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("limit must be between 1 and 200");
  const index = await readIndex(root);
  if (!index.nodes.some((node) => node.uid === uid)) throw new Error(`knowledge node '${uid}' was not found`);
  const selected = new Set([uid]); let frontier = [uid]; const edges = [];
  for (let level = 0; level < depth && selected.size < limit; level += 1) {
    const next = [];
    for (const source of frontier) for (const edge of index.edges) {
      if (edge.from !== source && edge.to !== source) continue;
      edges.push(edge);
      const target = edge.from === source ? edge.to : edge.from;
      if (!selected.has(target) && selected.size < limit) { selected.add(target); next.push(target); }
    }
    frontier = next;
  }
  return { nodes: index.nodes.filter((node) => selected.has(node.uid)), edges: edges.filter((edge) => selected.has(edge.from) && selected.has(edge.to)), truncated: selected.size >= limit && index.edges.some((edge) => selected.has(edge.from) || selected.has(edge.to)) };
}
