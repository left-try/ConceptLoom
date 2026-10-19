#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildEvalReport } from "../src/evaluation/report.mjs";
import { runOffline } from "./eval-offline.mjs";
import { runStructuralSuite } from "./eval-structural.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJsonl(path) {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

export async function runEvaluationReport({ projectRoot = root, outputPath = resolve(projectRoot, ".concept-loom/evaluation/report.json"), modelReportPath = resolve(projectRoot, ".concept-loom/evaluation/model-report.json") } = {}) {
  const structural = await runStructuralSuite({ datasetPath: resolve(projectRoot, "evals/datasets/contracts.json") });
  const offline = await runOffline({ datasetPath: resolve(projectRoot, "evals/datasets/recorded.json") });
  const teachingPath = resolve(projectRoot, "evals/datasets/teaching.jsonl");
  const teachingBytes = await readFile(teachingPath);
  const teachingDigest = `sha256:${createHash("sha256").update(teachingBytes).digest("hex")}`;
  const teaching = teachingBytes.toString("utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const labels = await readJsonl(resolve(projectRoot, "evals/labels/teaching.jsonl"));
  let modelReport;
  try { modelReport = JSON.parse(await readFile(modelReportPath, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const validTeachingIds = new Set(teaching.map(row => row.caseId));
  const modelResults = modelReport?.datasetDigest === teachingDigest && Array.isArray(modelReport.results)
    ? modelReport.results.filter(row => validTeachingIds.has(row.caseId) && ["completed", "error", "skipped"].includes(row.status))
    : [];
  const structuralResults = structural.results.map(row => ({ ...row, caseId: row.caseId }));
  const recordedResults = offline.results.flatMap(row => row.candidates.map(candidate => ({
    caseId: `recorded/${row.caseId}/${candidate.id}`,
    status: "completed",
    passed: candidate.passed,
    diagnostics: candidate.diagnostics,
  })));
  const teachingSplits = Object.fromEntries(["calibration", "holdout"].map(split => {
    const cases = teaching.filter(row => row.split === split);
    const completed = modelResults.filter(row => row.split === split && row.status === "completed").length;
    return [split, { expected: cases.length, completed, pending: cases.length - completed }];
  }));
  const expectedCaseIds = [
    ...structural.expectedCaseIds,
    ...recordedResults.map(row => row.caseId),
    ...teaching.map(row => row.caseId),
  ];
  const normalizedModelResults = modelResults.map(row => ({
    caseId: row.caseId,
    status: row.status,
    ...(row.status === "completed" ? { passed: row.passed === true } : {}),
    diagnostics: row.diagnostics ?? [],
  }));
  const sourceHashes = [...new Set(teaching.map(row => row.source?.contentHash).filter(Boolean))];
  const report = buildEvalReport({
    expectedCaseIds,
    results: [...structuralResults, ...recordedResults, ...normalizedModelResults],
    datasetVersion: `contracts:${structural.datasetDigest}; recorded:${offline.datasetDigest}; teaching:${teachingDigest}`,
    evaluatorSetVersion: "structural/1; recorded/1; teaching-rubric/1",
    sourceHashes,
    pendingLabels: labels.filter(row => row.status !== "reviewed").length,
    teachingSplits,
  });
  const envelope = { schemaVersion: 1, generatedAt: new Date().toISOString(), ...report };
  const destination = resolve(outputPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  await writeFile(destination.replace(/\.json$/i, ".md"), `${report.markdown}\n`, "utf8");
  return envelope;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const index = process.argv.indexOf("--output");
    const outputPath = index >= 0 ? process.argv[index + 1] : undefined;
    const report = await runEvaluationReport({ outputPath });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.gate.pass ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
