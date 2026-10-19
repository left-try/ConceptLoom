#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateLabels } from "../src/evaluation/rubrics.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jsonl = async path => (await readFile(path, "utf8")).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line.replace(/^\uFEFF/, "")));

export async function validateTeachingDataset({ datasetPath, labelsPath, splitsPath } = {}) {
  const [cases, labels, splits] = await Promise.all([
    jsonl(datasetPath ?? resolve(root, "evals/datasets/teaching.jsonl")),
    jsonl(labelsPath ?? resolve(root, "evals/labels/teaching.jsonl")),
    readFile(splitsPath ?? resolve(root, "evals/datasets/splits.json"), "utf8").then(text => JSON.parse(text.replace(/^\uFEFF/, ""))),
  ]);
  const diagnostics = validateLabels(cases, labels, splits);
  return { valid: diagnostics.every(item => item.severity !== "error"), caseCount: cases.length, labelCount: labels.length, diagnostics };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await validateTeachingDataset();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
