import fs from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { parseKnowledge } from "./format.mjs";
import { resolveContainedPath } from "../storage/paths.mjs";

async function walk(directory) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const result = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`export source contains a symbolic link: ${path}`);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

export async function exportKnowledge(root, { format = "okf", destination, includeAssets = true, includePersonal = false } = {}) {
  if (!["okf", "obsidian"].includes(format)) throw new Error("format must be okf or obsidian");
  if (typeof destination !== "string" || !destination) throw new Error("destination is required");
  if (includePersonal && format !== "obsidian") throw new Error("Personal export requires explicit Obsidian format");
  const bundle = await resolveContainedPath(root, "vault/Knowledge");
  const canonicalOutput = await resolveContainedPath(root, destination, { create: false });
  const output = canonicalOutput;
  const relOut = relative(bundle, output);
  if (!relOut || (!relOut.startsWith("..") && !relOut.includes(":")) || relative(output, bundle) === "" || relative(output, bundle).startsWith("..") === false) throw new Error("export destination cannot overlap the source Knowledge bundle or vault");
  const sources = await walk(bundle);
  const selected = sources.filter(path => {
    const rel = relative(bundle, path).split("\\").join("/");
    return rel.endsWith(".md") || (includeAssets && rel.startsWith("assets/"));
  });
  const checked = [];
  for (const file of selected) {
    const rel = relative(bundle, file).split("\\").join("/");
    checked.push({ file: await resolveContainedPath(bundle, rel), rel });
  }
  const personalFiles = format === "obsidian" && includePersonal ? await walk(await resolveContainedPath(root, "vault/Personal")) : [];
  const personalChecked = [];
  for (const file of personalFiles.filter(path => path.toLowerCase().endsWith(".md"))) {
    const rel = relative(await resolveContainedPath(root, "vault/Personal"), file).split("\\").join("/");
    personalChecked.push({ file: await resolveContainedPath(await resolveContainedPath(root, "vault/Personal"), rel), rel: `Personal/${rel}` });
  }
  const notes = [];
  const diagnostics = [];
  const missingAssets = [];
  const externalDependencies = [];
  for (const item of checked.filter(item => item.rel.endsWith(".md"))) {
    const parsed = parseKnowledge(await fs.readFile(item.file, "utf8"), { path: item.rel, bundleRoot: bundle });
    if (parsed.node.resource && /^https?:/i.test(parsed.node.resource)) externalDependencies.push({ path: item.rel, resource: parsed.node.resource });
    if (parsed.node.uid && parsed.node.conceptloom?.access === "full" && !checked.some(asset => asset.rel.startsWith(`assets/${parsed.node.uid}/`))) missingAssets.push({ sourceUid: parsed.node.uid, path: item.rel, status: "missing" });
    const resource = parsed.node.resource;
    if (resource && /^https?:/i.test(resource) && !externalDependencies.some(dep => dep.resource === resource && dep.path === item.rel)) externalDependencies.push({ path: item.rel, resource });
  }
  await fs.mkdir(output, { recursive: true });
  const assets = [];
  const outputFiles = [];
  for (const item of [...checked, ...personalChecked]) {
    const target = await resolveContainedPath(output, item.rel, { create: true });
    const bytes = await fs.readFile(item.file);
    await fs.writeFile(target, bytes);
    outputFiles.push(item.rel);
    if (item.rel.startsWith("assets/")) assets.push({ path: item.rel, hash: hash(bytes), status: "copied" });
  }
  for (const missing of missingAssets) { assets.push(missing); diagnostics.push({ severity: "warning", code: "EXPORT_ASSET_MISSING", ...missing }); }
  const manifest = { schemaVersion: 1, format, files: outputFiles.sort(), assets, externalDependencies };
  return { manifest, diagnostics };
}
