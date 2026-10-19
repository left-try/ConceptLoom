#!/usr/bin/env node
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runModelEval } from "../src/evaluation/rubrics.mjs";
import { validateTeachingDataset } from "./eval-validate.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const splitLines = text => text.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line.replace(/^\uFEFF/, "")));

function argsFrom(argv) {
  const args = { allowPaid: argv.includes("--allow-paid") };
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--") || argv[index] === "--allow-paid") continue;
    const name = argv[index].slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${name}`);
    args[name] = value;
    index += 1;
  }
  return args;
}

export async function runModelEvalCommand(argv = process.argv.slice(2)) {
  const args = argsFrom(argv);
  if (args["allow-paid"] !== true) throw new Error("refusing model judge run without --allow-paid");
  const providerId = args.provider;
  const budgetUsd = Number(args["budget-usd"]);
  const costPerCaseUsd = Number(args["cost-per-case-usd"]);
  const maxCases = Number(args["max-cases"]);
  if (!providerId) throw new Error("--provider is required; no default judge is selected");
  if (!Number.isFinite(costPerCaseUsd) || costPerCaseUsd <= 0) throw new Error("--cost-per-case-usd must be a known positive estimate");
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) throw new Error("--budget-usd must be positive");
  if (!Number.isInteger(maxCases) || maxCases < 1) throw new Error("--max-cases must be a positive integer");

  const datasetPath = resolve(args.dataset ?? resolve(root, "evals/datasets/teaching.jsonl"));
  const labelsPath = resolve(args.labels ?? resolve(root, "evals/labels/teaching.jsonl"));
  const splitsPath = resolve(args.splits ?? resolve(root, "evals/datasets/splits.json"));
  const validation = await validateTeachingDataset({ datasetPath, labelsPath, splitsPath });
  if (!validation.valid) throw new Error(`teaching dataset is invalid: ${validation.diagnostics.filter(item => item.severity === "error").map(item => item.code).join(", ")}`);
  const datasetBytes = await readFile(datasetPath);
  const cases = splitLines(datasetBytes.toString("utf8"));
  const labels = splitLines(await readFile(labelsPath, "utf8"));
  const splits = JSON.parse((await readFile(splitsPath, "utf8")).replace(/^\uFEFF/, ""));
  const humanLabelsById = new Map(labels.filter(label => label.status === "reviewed").map(label => [label.caseId, label]));

  const requireEvalPackage = createRequire(resolve(root, "evals/package.json"));
  const { loadApiProvider } = requireEvalPackage("promptfoo");
  const judge = await loadApiProvider(providerId);
  const rubric = await readFile(resolve(root, "evals/rubrics/teaching-judge.md"), "utf8");
  const provider = {
    estimateCost: () => costPerCaseUsd,
    runCase: async row => {
      const prompt = `${rubric}\n\n<task>${row.prompt}</task>\n\n<source uid="${row.source.uid}" locator="${row.source.locator}" contentHash="${row.source.contentHash}">${row.source.excerpt}</source>\n\n<candidate-output>${row.candidateOutput}</candidate-output>\n\nReturn JSON with dimensions, criticalFailures, and a brief rationale.`;
      const result = await judge.callApi(prompt, { vars: { caseId: row.caseId } });
      if (result?.error) throw new Error(String(result.error));
      const parsed = JSON.parse(typeof result?.output === "string" ? result.output : "null");
      return { ...parsed, cost: result.cost, humanLabel: humanLabelsById.get(row.caseId) };
    },
  };
  const report = await runModelEval({ cases, provider, budgetUsd, maxCases, allowPaid: true, splits });
  report.datasetDigest = `sha256:${createHash("sha256").update(datasetBytes).digest("hex")}`;
  report.providerId = judge.id?.() ?? providerId;
  report.humanReviewedLabels = [...humanLabelsById.keys()].filter(id => report.results.some(row => row.caseId === id));
  report.pendingReviewCount = labels.filter(label => label.status === "pending-review").length;
  const destination = resolve(args.output ?? resolve(root, ".concept-loom/evaluation/model-report.json"));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { ...report, reportPath: destination };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await runModelEvalCommand();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.results.some(row => row.status !== "completed" || row.passed !== true)) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
