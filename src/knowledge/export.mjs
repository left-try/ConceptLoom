import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { resolveContainedPath } from "../storage/paths.mjs";
import { getSource } from "../sources/import.mjs";

async function markdownFiles(directory) {
  let result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("vault export refuses symbolic links");
    if (entry.isDirectory()) result = result.concat(await markdownFiles(path));
    else if (entry.isFile() && path.endsWith(".md")) result.push(path);
  }
  return result;
}

export async function exportKnowledge(root, { format = "obsidian", destination = "exports/knowledge", includeAssets = true } = {}) {
  if (!new Set(["obsidian", "okf"]).has(format)) throw new Error("format must be obsidian or okf");
  const sourceRoot = await resolveContainedPath(root, "vault/Knowledge");
  const output = await resolveContainedPath(root, destination, { create: true });
  const rel = relative(sourceRoot, output);
  if (!rel.startsWith("..") && rel !== "") throw new Error("export destination cannot overlap the source vault");
  await mkdir(output, { recursive: true });
  for (const file of await markdownFiles(sourceRoot)) {
    const relativePath = relative(sourceRoot, file);
    if (relativePath.split(/[\\/]/).includes("Personal")) continue;
    const target = await resolveContainedPath(root, relative(output, join(output, relativePath)), { create: true }); await mkdir(dirname(target), { recursive: true }); await cp(file, target, { force: true });
  }
  const assets = []; const external = [];
  try {
    const sourceDirectory = join(root, ".concept-loom", "sources");
    for (const sourceUid of await readdir(sourceDirectory)) {
      const manifest = await getSource(root, { sourceUid });
      const current = manifest.versions.find((item) => item.contentHash === manifest.currentContentHash);
      if (!includeAssets || !current?.assetPath) { external.push({ uid: sourceUid, resource: manifest.canonicalResource, coverage: manifest.coverage }); continue; }
      const assetTarget = await resolveContainedPath(root, relative(root, join(output, "assets", sourceUid, manifest.currentContentHash.slice(7) + ".md")), { create: true });
      await mkdir(dirname(assetTarget), { recursive: true }); await cp(join(root, current.assetPath), assetTarget);
      assets.push({ uid: sourceUid, path: relative(output, assetTarget).replaceAll("\\", "/"), contentHash: current.contentHash });
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const manifest = { format, createdAt: new Date().toISOString(), assets, external, personalNotesExcluded: true };
  await writeFile(join(output, "conceptloom-export.json"), JSON.stringify(manifest, null, 2));
  return { manifest, diagnostics: external.map((item) => `Source '${item.uid}' remains external or has no stored original.`) };
}
