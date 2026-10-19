import fs from "node:fs/promises";
import { join, relative, resolve, posix } from "node:path";
import { createHash } from "node:crypto";
import { parseKnowledge } from "./format.mjs";
import { resolveContainedPath } from "../storage/paths.mjs";

const indexPath = ".concept-loom/knowledge/index.json";
const hash = value => createHash("sha256").update(value).digest("hex");

async function filesUnder(directory) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const result = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(path));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) result.push(path);
  }
  return result;
}

function plainMarkdown(body) { return body.replace(/(```|~~~)[\s\S]*?\1/g, match => "\n".repeat((match.match(/\n/g) ?? []).length)); }

function linksFrom(body) {
  const text = plainMarkdown(body), links = [];
  for (const match of text.matchAll(/!?(?:\[([^\]]*)\])\(([^)]+)\)/g)) {
    const destination = match[2].trim().replace(/^<|>$/g, "");
    if (/^(?:https?:|mailto:|data:)/i.test(destination)) continue;
    const [rawPath, ...anchorParts] = destination.split("#");
    links.push({ label: match[1], target: rawPath, anchor: anchorParts.join("#") || undefined, offset: match.index });
  }
  for (const match of text.matchAll(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g)) links.push({ kind: "wikilink", target: match[1].trim(), anchor: match[2], label: match[3], offset: match.index });
  return links;
}

function targetPath(sourcePath, target) {
  if (!target || target.startsWith("#")) return sourcePath;
  try { target = decodeURIComponent(target); } catch { return null; }
  const joined = posix.normalize(posix.join(posix.dirname(sourcePath), target));
  if (joined === ".." || joined.startsWith("../") || joined.startsWith("/")) return null;
  return joined.toLowerCase().endsWith(".md") ? joined : `${joined}.md`;
}

export async function indexKnowledge(root, { includePersonal = false } = {}) {
  const bundleRoot = await resolveContainedPath(root, "vault/Knowledge");
  const nodes = [], byPath = new Map(), diagnostics = [];
  for (const absolute of await filesUnder(bundleRoot)) {
    const path = relative(bundleRoot, absolute).split("\\").join("/");
    const source = await fs.readFile(absolute, "utf8");
    const parsed = parseKnowledge(source, { path, bundleRoot });
    const node = { ...parsed.node, body: parsed.body, scope: "knowledge", bodyHash: hash(parsed.body) };
    if (node.type === "Index" || node.type === "Log") continue;
    nodes.push(node); byPath.set(path, node);
    diagnostics.push(...parsed.diagnostics.map(item => ({ ...item, path })));
  }
  if (includePersonal) {
    const personalRoot = await resolveContainedPath(root, "vault/Personal");
    for (const absolute of await filesUnder(personalRoot)) {
      const path = relative(personalRoot, absolute).split("\\").join("/");
      const body = await fs.readFile(absolute, "utf8");
      nodes.push({ id: `Personal/${path.replace(/\.md$/i, "")}`, path: `Personal/${path}`, title: body.match(/^#\s+(.+)$/m)?.[1] ?? path, type: "Personal", aliases: [], body, bodyHash: hash(body), scope: "personal" });
    }
  }
  const allTargets = [...nodes];
  const edges = [];
  const addEdge = (from, to, kind, locator) => {
    if (!to) return;
    let edge = edges.find(item => item.from === from.id && item.to === to.path && item.kind === kind);
    if (!edge) { edge = { from: from.id, to: to.path, kind, occurrences: [] }; edges.push(edge); }
    if (locator?.anchor) edge.locator = { ...(edge.locator ?? {}), anchor: locator.anchor };
    edge.occurrences.push({ locator: { ...(locator ?? {}) } });
  };
  for (const node of nodes) {
    const markdownPath = node.path.startsWith("Personal/") ? node.path.slice("Personal/".length) : node.path;
    for (const relation of node.conceptloom?.relations ?? []) {
      const relationTarget = String(relation.target).replaceAll("\\", "/");
      const resolved = relationTarget.startsWith("./") || relationTarget.startsWith("../")
        ? targetPath(markdownPath, relationTarget)
        : relationTarget.toLowerCase().endsWith(".md") ? relationTarget : `${relationTarget}.md`;
      const target = allTargets.find(item => item.path === resolved || item.id === relation.target || item.uid === relation.target);
      if (target) addEdge(node, target, relation.kind, { relation: true });
      else diagnostics.push({ severity: "warning", code: "BROKEN_RELATION", path: node.path, target: relation.target });
    }
    for (const link of linksFrom(node.body ?? "")) {
      let target;
      if (link.kind === "wikilink") {
        const key = link.target.toLocaleLowerCase();
        const matches = allTargets.filter(item => item.title?.toLocaleLowerCase() === key || item.uid?.toLocaleLowerCase() === key || item.id?.toLocaleLowerCase() === key || item.path.replace(/\.md$/i, "").toLocaleLowerCase() === key || (item.aliases ?? []).some(alias => alias.toLocaleLowerCase() === key));
        if (matches.length > 1) { diagnostics.push({ severity: "warning", code: "AMBIGUOUS_WIKILINK", path: node.path, target: link.target }); continue; }
        target = matches[0];
      } else {
        const candidate = targetPath(markdownPath, link.target);
        target = candidate && allTargets.find(item => item.path === candidate);
      }
      if (!target) { diagnostics.push({ severity: "warning", code: "BROKEN_LINK", path: node.path, target: link.target }); continue; }
      addEdge(node, target, link.kind ?? "link", { offset: link.offset, ...(link.anchor ? { anchor: link.anchor } : {}) });
    }
  }
  const contentFingerprint = hash(JSON.stringify({ nodes: nodes.map(({ id, bodyHash, type, title, aliases, relations }) => ({ id, bodyHash, type, title, aliases, relations })), edges }));
  const previous = await fs.readFile(await resolveContainedPath(root, indexPath), "utf8").then(JSON.parse).catch(() => null);
  const revision = previous?.fingerprint === contentFingerprint ? previous.revision : hash(contentFingerprint).slice(0, 24);
  const index = { schemaVersion: 1, revision, fingerprint: contentFingerprint, nodes, edges, diagnostics };
  const destination = await resolveContainedPath(root, indexPath, { create: true });
  await fs.writeFile(destination, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}

async function loadIndex(root) {
  const path = await resolveContainedPath(root, indexPath);
  return JSON.parse(await fs.readFile(path, "utf8"));
}

export async function getKnowledgeNode(root, { uid, path } = {}) {
  if (path) {
    if (path.startsWith("/") || path.split(/[\\/]/).includes("..")) throw new Error("Knowledge node path must stay inside the bundle.");
    const bundle = await resolveContainedPath(root, "vault/Knowledge");
    const absolute = await resolveContainedPath(bundle, path);
    const content = await fs.readFile(absolute, "utf8");
    const rel = relative(bundle, absolute).split("\\").join("/");
    const parsed = parseKnowledge(content, { path: rel, bundleRoot: bundle });
    return { ...parsed.node, body: parsed.body, bodyHash: hash(parsed.body), scope: "knowledge" };
  }
  const index = await indexKnowledge(root);
  const node = index.nodes.find(item => item.uid === uid || item.id === uid);
  if (!node) throw new Error(`Knowledge node not found: ${uid}`);
  return node;
}

export async function getNeighborhood(root, { uid, depth = 1, limit = 50 } = {}) {
  if (!Number.isInteger(depth) || depth < 0 || depth > 3) throw new Error("depth must be between 0 and 3");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("limit must be between 1 and 200");
  const index = await indexKnowledge(root);
  const start = index.nodes.find(item => item.uid === uid || item.id === uid);
  if (!start) throw new Error(`Knowledge node not found: ${uid}`);
  const seen = new Set([start.id]), queue = [{ node: start, depth: 0 }], edges = [];
  while (queue.length) {
    const { node, depth: level } = queue.shift();
    if (level >= depth) continue;
    for (const edge of index.edges.filter(item => item.from === node.id || index.nodes.find(n => n.path === item.to)?.id === node.id)) {
      if (!edges.includes(edge)) edges.push(edge);
      const otherPath = edge.from === node.id ? edge.to : index.nodes.find(n => n.id === edge.from)?.path;
      const other = index.nodes.find(item => item.path === otherPath);
      if (other && !seen.has(other.id)) { seen.add(other.id); queue.push({ node: other, depth: level + 1 }); }
    }
  }
  const all = [...seen];
  const truncated = all.length > limit;
  const selectedIds = new Set(all.slice(0, limit));
  const selectedNodes = index.nodes.filter(item => selectedIds.has(item.id));
  const nodePaths = new Set(selectedNodes.map(item => item.path));
  return { revision: index.revision, nodes: selectedNodes, edges: edges.filter(edge => nodePaths.has(edge.to) && selectedIds.has(edge.from)), truncated };
}
