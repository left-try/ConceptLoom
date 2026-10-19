import fs from "node:fs/promises";
import { join, relative } from "node:path";
import { parseDocument } from "yaml";
import { resolveContainedPath } from "../storage/paths.mjs";

const PROFILE = "conceptloom/1";
const error = (code, message) => ({ severity: "error", code, message });
const warning = (code, message) => ({ severity: "warning", code, message });

function splitMarkdown(markdown) {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  return match ? { yaml: match[1], body: markdown.slice(match[0].length), frontmatter: true } : { yaml: "", body: markdown, frontmatter: false };
}

function safeId(path) {
  const normalized = String(path ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
  return normalized.toLowerCase().endsWith(".md") ? normalized.slice(0, -3) : normalized;
}

export function parseKnowledge(markdown, { path = "", bundleRoot } = {}) {
  const diagnostics = [];
  const parts = splitMarkdown(String(markdown));
  const document = parseDocument(parts.yaml, { uniqueKeys: true, prettyErrors: false });
  if (!parts.frontmatter && !/^index\.md$/i.test(String(path).replaceAll("\\", "/")) && !/^log\.md$/i.test(String(path).replaceAll("\\", "/"))) diagnostics.push(error("OKF_FRONTMATTER_REQUIRED", "Ordinary Knowledge notes require YAML frontmatter."));
  for (const issue of document.errors) diagnostics.push(error(issue.code === "DUPLICATE_KEY" ? "OKF_DUPLICATE_KEY" : "OKF_INVALID_YAML", issue.message));
  const metadata = document.errors.length ? {} : (document.toJSON() ?? {});
  const normalizedPath = String(path).replaceAll("\\", "/");
  const root = normalizedPath.toLowerCase() === "index.md";
  const log = normalizedPath.toLowerCase() === "log.md";
  if (!root && !log && (typeof metadata.type !== "string" || !metadata.type.trim())) diagnostics.push(error("OKF_TYPE_REQUIRED", "Ordinary Knowledge notes require a non-empty type."));
  if (root && metadata.okf_version !== undefined && metadata.okf_version !== "0.2") diagnostics.push(error("OKF_INVALID_INDEX_METADATA", "Root index.md must declare OKF version 0.2."));
  if (!root && metadata.okf_version !== undefined) diagnostics.push(error("OKF_INVALID_INDEX_METADATA", "okf_version is only valid in the bundle root index.md."));
  if (log && parts.body) for (const heading of parts.body.matchAll(/^##\s+(.+)\s*$/gm)) if (!/^\d{4}-\d{2}-\d{2}$/.test(heading[1].trim())) diagnostics.push(error("OKF_LOG_DATE_REQUIRED", "Knowledge log entries must use YYYY-MM-DD headings."));
  if (log && !/^##\s+\d{4}-\d{2}-\d{2}\s*$/m.test(parts.body)) diagnostics.push(error("OKF_LOG_DATE_REQUIRED", "Knowledge log requires at least one YYYY-MM-DD heading."));
  const conceptloom = metadata.conceptloom && typeof metadata.conceptloom === "object" ? metadata.conceptloom : {};
  const node = {
    ...metadata,
    id: safeId(path), path: normalizedPath, type: metadata.type ?? (root ? "Index" : log ? "Log" : undefined),
    title: metadata.title ?? parts.body.match(/^#\s+(.+)$/m)?.[1],
    aliases: metadata.aliases ?? [], sources: metadata.sources ?? [], relations: conceptloom.relations ?? metadata.relations ?? [],
    uid: conceptloom.uid ?? metadata.uid, conceptloom,
  };
  if (bundleRoot) node.bundleRoot = bundleRoot;
  return { node, document, body: parts.body, diagnostics, frontmatter: parts.frontmatter };
}

export function validateKnowledge(parsed, { strictProfile = false } = {}) {
  const diagnostics = [...parsed.diagnostics];
  const node = parsed.node;
  if (!node || !node.id) diagnostics.push(error("OKF_NODE_INVALID", "Knowledge node is missing a path-derived id."));
  if (node && !["Index", "Log"].includes(node.type) && (typeof node.type !== "string" || !node.type)) diagnostics.push(error("OKF_TYPE_REQUIRED", "Knowledge node requires a type."));
  if (strictProfile) {
    const profile = node?.conceptloom;
    if (profile && profile.profile !== PROFILE) diagnostics.push(error("CL_PROFILE_UNSUPPORTED", `Expected profile ${PROFILE}.`));
    if (profile?.uid !== undefined && (typeof profile.uid !== "string" || !/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(profile.uid))) diagnostics.push(error("CL_UID_INVALID", "ConceptLoom uid must be a stable slug."));
    if (profile?.relations !== undefined && (!Array.isArray(profile.relations) || profile.relations.some(item => !item || typeof item.kind !== "string" || typeof item.target !== "string" || item.target.startsWith("/") || item.target.split(/[\\/]/).includes("..")))) diagnostics.push(error("CL_RELATION_INVALID", "Relations must use a kind and a workspace-relative target."));
  }
  return diagnostics;
}

export function serializeKnowledge(parsed, { metadataPatch = {}, body } = {}) {
  if (parsed.document.errors.length || parsed.diagnostics.some(item => item.severity === "error" && ["OKF_INVALID_YAML", "OKF_DUPLICATE_KEY"].includes(item.code))) throw new Error("Cannot serialize invalid YAML or duplicate metadata keys.");
  for (const [key, value] of Object.entries(metadataPatch)) parsed.document.set(key, value);
  const outputBody = body === undefined ? parsed.body : body;
  return `---\n${parsed.document.toString().trimEnd()}\n---\n${outputBody}`;
}

export async function initializeKnowledge(root) {
  const bundleRoot = join(root, "vault", "Knowledge");
  const vaultRoot = join(root, "vault");
  await fs.mkdir(await resolveContainedPath(root, "vault/Knowledge/assets", { create: true }), { recursive: true });
  await fs.mkdir(await resolveContainedPath(root, "vault/Personal", { create: true }), { recursive: true });
  const defaults = new Map([
    [join(bundleRoot, "index.md"), '---\nokf_version: "0.2"\n---\n# Knowledge\n\nWelcome to your portable Knowledge vault.\n'],
    [join(bundleRoot, "log.md"), `# Knowledge log\n\n## ${new Date().toISOString().slice(0, 10)}\n- Initialized Knowledge vault.\n`],
  ]);
  for (const [path, contents] of defaults) {
    const relativePath = relative(root, path);
    const containedPath = await resolveContainedPath(root, relativePath, { create: true });
    try { await fs.writeFile(containedPath, contents, { encoding: "utf8", flag: "wx" }); }
    catch (cause) { if (cause.code !== "EEXIST") throw cause; }
  }
  return { vaultRoot, bundleRoot };
}
