import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveContainedPath } from "../storage/paths.mjs";

const catalogPath = ".concept-loom/sources/catalog.json";
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../python");
const fail = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code });

export async function convertDocument(root, { sourceUid, pythonExecutable = "python", ocrMode = "auto", languages = ["en"], timeoutMs = 120000, resumeFrom } = {}) {
  let catalog;
  try { catalog = JSON.parse(await fs.readFile(await resolveContainedPath(root, catalogPath), "utf8")); }
  catch (error) { if (error.code === "ENOENT") throw fail("SOURCE_NOT_FOUND", "source manifest is missing"); throw error; }
  const source = catalog.sources?.[sourceUid];
  if (!source) throw fail("SOURCE_NOT_FOUND", `unknown source ${sourceUid}`);
  const version = [...source.versions].reverse().find(item => item.contentHash === source.currentContentHash) ?? source.versions.at(-1);
  if (!version?.assetPath) throw fail("SOURCE_ASSET_MISSING", "source has no local asset to convert");
  const inputPath = await resolveContainedPath(root, `vault/Knowledge/${version.assetPath}`);
  const outputDirectory = await resolveContainedPath(root, `.concept-loom/sources/conversions/${sourceUid}/${version.contentHash ?? "unversioned"}`, { create: true });
  const oldPagesPath = join(outputDirectory, "pages.json");
  const oldPages = await fs.readFile(oldPagesPath, "utf8").then(JSON.parse).catch(() => []);
  const resumePages = resumeFrom?.pages;
  const request = { schemaVersion: 1, inputPath, outputDirectory, ocrMode, languages, ...(resumeFrom ? { resumeFrom } : {}) };
  const worker = await new Promise((resolvePromise, reject) => {
    let child;
    try { child = spawn(pythonExecutable, ["-m", "conceptloom_documents"], { cwd: packageRoot, env: { ...process.env, PYTHONPATH: [packageRoot, process.env.PYTHONPATH].filter(Boolean).join(process.platform === "win32" ? ";" : ":") }, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (error) { reject(fail("CONVERTER_UNAVAILABLE", `Python converter unavailable: ${error.message}`)); return; }
    let stdout = "", stderr = "", settled = false;
    const timer = setTimeout(() => { child.kill(); if (!settled) { settled = true; reject(fail("CONVERTER_TIMEOUT", `document converter timed out after ${timeoutMs}ms`)); } }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.on("error", error => { clearTimeout(timer); if (!settled) { settled = true; reject(fail("CONVERTER_UNAVAILABLE", `Python converter unavailable: ${error.message}`)); } });
    child.on("close", code => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0) { reject(fail("CONVERTER_FAILED", stderr.trim() || `document worker exited with ${code}`)); return; }
      try {
        const events = stdout.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
        const results = events.filter(event => event.type === "result");
        if (results.length !== 1 || !Array.isArray(results[0].pages)) throw new Error("worker did not return exactly one result");
        resolvePromise({ pages: results[0].pages });
      } catch (error) { reject(fail("CONVERTER_PROTOCOL", `invalid converter output: ${error.message}`)); }
    });
    child.stdin.end(JSON.stringify(request));
  });
  const processedPages = worker.pages.map(page => page.page);
  const merged = new Map(oldPages.map(page => [page.page, page]));
  for (const page of worker.pages) merged.set(page.page, { ...page, contentHash: version.contentHash, locator: { ...page.locator, sourceUid, contentHash: version.contentHash } });
  const pages = [...merged.values()].sort((a, b) => a.page - b.page);
  await fs.writeFile(oldPagesPath, `${JSON.stringify(pages, null, 2)}\n`, "utf8");
  const retryable = pages.filter(page => page.quality.status !== "usable").map(page => page.page);
  return { sourceUid, contentHash: version.contentHash, pages, processedPages, resumeFrom: { pages: retryable }, diagnostics: [] };
}
