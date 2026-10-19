#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { evaluateDeterministic } from "../src/evaluation/assertions.mjs";
import { renderEvalPrompt } from "../evals/providers/opf.mjs";
import { runStructuralSuite } from "./eval-structural.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function runOffline({ datasetPath = resolve(root, "evals/datasets/recorded.json"), outputPath } = {}) {
  const datasetBytes = await readFile(datasetPath);
  const dataset = JSON.parse(datasetBytes.toString("utf8"));
  const structural = await runStructuralSuite();
  if (dataset.schemaVersion !== 1 || !Array.isArray(dataset.cases)) throw new Error("invalid recorded evaluation dataset");
  const seen = new Set();
  const results = [];
  for (const row of dataset.cases) {
    if (typeof row.caseId !== "string" || seen.has(row.caseId) || !Array.isArray(row.candidates) || !row.candidates.length) throw new Error(`invalid or duplicate recorded case: ${String(row.caseId)}`);
    seen.add(row.caseId);
    const prompt = row.promptId ? await renderEvalPrompt({ id: row.promptId, inputs: row.inputs }) : undefined;
    const candidates = row.candidates.map(candidate => {
      if (typeof candidate.id !== "string" || typeof candidate.output !== "string") throw new Error(`invalid recorded candidate in ${row.caseId}`);
      const check = evaluateDeterministic({ ...row.assertion, caseId: row.caseId,
        markdown: ["citation", "knowledge-links"].includes(row.assertion?.type) ? candidate.output : row.assertion?.markdown,
        publicText: row.assertion?.type === "concealment" ? candidate.output : row.assertion?.publicText,
      })[0];
      return { id: candidate.id, output: candidate.output, passed: check.passed, diagnostics: check.diagnostics };
    });
    results.push({ caseId: row.caseId, promptId: prompt?.id, promptDigest: prompt?.digest, candidates });
  }
  const report = {
    schemaVersion: 1,
    mode: "recorded-offline",
    datasetDigest: `sha256:${createHash("sha256").update(datasetBytes).digest("hex")}`,
    structural,
    expectedCaseIds: dataset.cases.map(row => row.caseId),
    results,
    exitCode: structural.exitCode === 0 && results.every(row => row.candidates.every(candidate => candidate.passed)) ? 0 : 1,
  };
  if (outputPath) {
    const destination = resolve(outputPath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const outputArg = process.argv.indexOf("--output");
    const outputPath = outputArg >= 0 ? process.argv[outputArg + 1] : undefined;
    const report = await runOffline({ outputPath });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.exitCode;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
