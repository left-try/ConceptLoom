import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function api() {
  try { return await import("../src/evaluation/rubrics.mjs"); }
  catch { return {}; }
}

async function dataset() {
  return (await readFile(resolve(root, "evals/datasets/teaching.jsonl"), "utf8"))
    .trim().split(/\r?\n/).map(line => JSON.parse(line));
}

test("teaching dataset covers RU/EN, both levels, all six situations, and balanced holdout", async () => {
  const { validateLabels } = await api();
  assert.equal(typeof validateLabels, "function");
  const cases = await dataset();
  const labels = (await readFile(resolve(root, "evals/labels/teaching.jsonl"), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
  const splits = JSON.parse(await readFile(resolve(root, "evals/datasets/splits.json"), "utf8"));
  assert.equal(cases.length, 24);
  assert.equal(validateLabels(cases, labels, splits).filter(item => item.severity === "error").length, 0);
});

test("dataset validator rejects split leakage and unbalanced coverage", async () => {
  const { validateLabels } = await api();
  assert.equal(typeof validateLabels, "function");
  const cases = await dataset();
  const labels = [];
  const splits = JSON.parse(await readFile(resolve(root, "evals/datasets/splits.json"), "utf8"));
  const duplicate = { ...splits, holdout: [...splits.holdout, splits.calibration[0]] };
  assert.ok(validateLabels(cases, labels, duplicate).some(item => item.code === "SPLIT_OVERLAP"));
  assert.ok(validateLabels(cases.slice(1), labels, splits).some(item => item.code === "DATASET_COVERAGE_INVALID"));
});

test("pending human labels are not calibration evidence and reviewed labels need supporting excerpts", async () => {
  const { validateLabels } = await api();
  assert.equal(typeof validateLabels, "function");
  const cases = await dataset();
  const labels = (await readFile(resolve(root, "evals/labels/teaching.jsonl"), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
  const splits = JSON.parse(await readFile(resolve(root, "evals/datasets/splits.json"), "utf8"));
  assert.ok(validateLabels(cases, labels, splits).some(item => item.code === "LABELS_PENDING_REVIEW"));
  const reviewed = labels.map((label, index) => index === 0 ? { ...label, status: "reviewed", supportingExcerpt: "" } : label);
  assert.ok(validateLabels(cases, reviewed, splits).some(item => item.code === "REVIEW_EVIDENCE_MISSING"));
});

test("required rubric dimensions and critical failures cannot be averaged away", async () => {
  const { scoreTeaching } = await api();
  assert.equal(typeof scoreTeaching, "function");
  const dimensions = { mechanism: 3, example: 3, level: 3, grounding: 1, limitations: 3, practice: 3 };
  assert.equal(scoreTeaching({ dimensions }).passed, false);
  assert.equal(scoreTeaching({ dimensions: { ...dimensions, grounding: 3 }, criticalFailures: ["solution-leak"] }).passed, false);
  assert.equal(scoreTeaching({ dimensions: { ...dimensions, grounding: 3 } }).passed, true);
});

test("paid model evaluation requires explicit authorization, budget, case cap, and a provider", async () => {
  const { runModelEval } = await api();
  assert.equal(typeof runModelEval, "function");
  let calls = 0;
  const provider = { estimateCost: () => 0.01, runCase: async () => { calls += 1; return { dimensions: {} }; } };
  await assert.rejects(runModelEval({ provider, budgetUsd: 1, maxCases: 1 }), /allow-paid/);
  await assert.rejects(runModelEval({ provider, allowPaid: true, maxCases: 1 }), /budget/i);
  await assert.rejects(runModelEval({ allowPaid: true, budgetUsd: 1, maxCases: 1 }), /provider/i);
  assert.equal(calls, 0);
});

test("unknown or over-budget judge cost is rejected before any paid call", async () => {
  const { runModelEval } = await api();
  assert.equal(typeof runModelEval, "function");
  const cases = await dataset();
  let calls = 0;
  const unknown = { runCase: async () => { calls += 1; return {}; } };
  await assert.rejects(runModelEval({ cases, provider: unknown, allowPaid: true, budgetUsd: 1, maxCases: 2 }), /cost/i);
  const expensive = { estimateCost: () => 1, runCase: async () => { calls += 1; return {}; } };
  await assert.rejects(runModelEval({ cases, provider: expensive, allowPaid: true, budgetUsd: 0.5, maxCases: 2 }), /budget/i);
  assert.equal(calls, 0);
});

test("judge failures are reported as errors and calibration stays separate from holdout", async () => {
  const { runModelEval } = await api();
  assert.equal(typeof runModelEval, "function");
  const cases = await dataset();
  const provider = {
    estimateCost: () => 0.01,
    runCase: async () => { throw new Error("judge unavailable"); },
  };
  const report = await runModelEval({ cases, provider, allowPaid: true, budgetUsd: 0.1, maxCases: 1 });
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].status, "error");
  assert.equal(report.calibration.length + report.holdout.length, 1);
  assert.equal(report.results[0].passed, undefined);
});

test("judge agreement is calculated only against reviewed human labels", async () => {
  const { runModelEval } = await api();
  const cases = [{ caseId: "cal-1", split: "calibration" }, { caseId: "hold-1", split: "holdout" }];
  let index = 0;
  const provider = {
    estimateCost: () => 0.01,
    runCase: async () => {
      index += 1;
      return {
        dimensions: { mechanism: 3, example: 2, level: 2, grounding: 2, limitations: 2, practice: 2 },
        criticalFailures: [],
        humanLabel: index === 1
          ? { status: "reviewed", dimensions: { mechanism: 2, example: 2, level: 2, grounding: 2, limitations: 2, practice: 2 } }
          : { status: "pending-review", dimensions: { mechanism: 0, example: 0, level: 0, grounding: 0, limitations: 0, practice: 0 } },
      };
    },
  };
  const report = await runModelEval({ cases, provider, allowPaid: true, budgetUsd: 1, maxCases: 2 });
  assert.deepEqual(report.results[0].agreement, { comparedDimensions: 6, exactMatches: 5, meanAbsoluteDifference: 1 / 6 });
  assert.equal(report.results[1].agreement, undefined);
  assert.equal(report.calibrationAgreement.meanAbsoluteDifference, 1 / 6);
  assert.equal(report.holdoutAgreement, undefined);
});
