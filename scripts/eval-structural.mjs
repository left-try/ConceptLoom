#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { evaluateDeterministic } from "../src/evaluation/assertions.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function runStructuralSuite({ datasetPath = resolve(root, "evals/datasets/contracts.json") } = {}) {
  const bytes = await readFile(datasetPath);
  const dataset = JSON.parse(bytes.toString("utf8"));
  if (dataset.schemaVersion !== 1 || !Array.isArray(dataset.cases)) throw new Error("invalid structural evaluation dataset");
  const ids = new Set();
  const results = dataset.cases.map(row => {
    if (typeof row.id !== "string" || ids.has(row.id) || !row.assertion || typeof row.expectedPassed !== "boolean") throw new Error(`invalid structural case: ${String(row.id)}`);
    ids.add(row.id);
    const actual = evaluateDeterministic({ ...row.assertion, caseId: row.id })[0];
    const passed = actual.passed === row.expectedPassed;
    return {
      caseId: row.id,
      domain: row.domain,
      evaluatorId: actual.evaluatorId,
      evaluatorVersion: actual.evaluatorVersion,
      status: "completed",
      passed,
      expectedOutcome: row.expectedPassed,
      actualOutcome: actual.passed,
      diagnostics: actual.diagnostics,
    };
  });
  return {
    schemaVersion: 1,
    mode: "deterministic-structural",
    datasetDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    expectedCaseIds: dataset.cases.map(row => row.id),
    results,
    exitCode: results.every(row => row.passed) ? 0 : 1,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await runStructuralSuite();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.exitCode;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
