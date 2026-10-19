const dimensionsRequired = ["mechanism", "example", "level", "grounding"];
const dimensionsAll = [...dimensionsRequired, "limitations", "practice"];
const languages = ["ru", "en"];
const levels = ["beginner", "experienced"];
const situations = ["normal-lesson", "uncertain-claim", "conflicting-sources", "partial-access", "resume", "interactive-practice"];
const hashPattern = /^sha256:[a-f0-9]{64}$/;

const issue = (code, message, severity = "error", caseId) => ({ severity, code, message, ...(caseId ? { caseId } : {}) });

function agreementFor(dimensions, humanLabel) {
  if (humanLabel?.status !== "reviewed") return undefined;
  const differences = dimensionsAll
    .filter(name => Number.isInteger(dimensions?.[name]) && Number.isInteger(humanLabel.dimensions?.[name]))
    .map(name => Math.abs(dimensions[name] - humanLabel.dimensions[name]));
  if (!differences.length) return undefined;
  return {
    comparedDimensions: differences.length,
    exactMatches: differences.filter(value => value === 0).length,
    meanAbsoluteDifference: differences.reduce((sum, value) => sum + value, 0) / differences.length,
  };
}

function aggregateAgreement(rows) {
  const agreements = rows.map(row => row.agreement).filter(Boolean);
  const comparedDimensions = agreements.reduce((sum, item) => sum + item.comparedDimensions, 0);
  if (!comparedDimensions) return undefined;
  return {
    comparedDimensions,
    exactMatches: agreements.reduce((sum, item) => sum + item.exactMatches, 0),
    meanAbsoluteDifference: agreements.reduce((sum, item) => sum + item.meanAbsoluteDifference * item.comparedDimensions, 0) / comparedDimensions,
  };
}

export function scoreTeaching({ dimensions = {}, criticalFailures = [] } = {}) {
  const diagnostics = [];
  for (const name of dimensionsAll) {
    const value = dimensions[name];
    if (!Number.isInteger(value) || value < 0 || value > 3) diagnostics.push(issue("DIMENSION_INVALID", `Dimension ${name} must be an integer from 0 to 3.`));
  }
  for (const name of Object.keys(dimensions)) if (!dimensionsAll.includes(name)) diagnostics.push(issue("DIMENSION_UNKNOWN", `Unknown teaching dimension ${name}.`));
  for (const name of dimensionsRequired) if (Number.isInteger(dimensions[name]) && dimensions[name] < 2) diagnostics.push(issue("REQUIRED_DIMENSION_BELOW_THRESHOLD", `Required dimension ${name} is below 2 of 3.`));
  for (const failure of criticalFailures) diagnostics.push(issue("CRITICAL_FAILURE", `Critical failure detected: ${String(failure)}.`));
  const valid = dimensionsAll.every(name => Number.isInteger(dimensions[name]) && dimensions[name] >= 0 && dimensions[name] <= 3)
    && Object.keys(dimensions).every(name => dimensionsAll.includes(name));
  const score = valid ? dimensionsAll.reduce((sum, name) => sum + dimensions[name], 0) / dimensionsAll.length : undefined;
  return { passed: valid && diagnostics.length === 0, ...(score === undefined ? {} : { score }), diagnostics };
}

export function validateLabels(cases, labels, splits) {
  const diagnostics = [];
  if (!Array.isArray(cases) || cases.length !== 24) diagnostics.push(issue("DATASET_COVERAGE_INVALID", "Teaching dataset must contain exactly 24 cases."));
  const caseRows = Array.isArray(cases) ? cases : [];
  const caseIds = new Set();
  const matrix = new Set();
  for (const row of caseRows) {
    if (typeof row.caseId !== "string" || !row.caseId || caseIds.has(row.caseId)) diagnostics.push(issue("CASE_ID_INVALID", "Case IDs must be non-empty and unique.", "error", row.caseId));
    caseIds.add(row.caseId);
    if (!languages.includes(row.language) || !levels.includes(row.level) || !situations.includes(row.situation)) diagnostics.push(issue("DATASET_COVERAGE_INVALID", "Case must use a supported language, level, and situation.", "error", row.caseId));
    const key = `${row.language}/${row.level}/${row.situation}`;
    if (matrix.has(key)) diagnostics.push(issue("DATASET_COVERAGE_INVALID", "Language-level-situation combination is duplicated.", "error", row.caseId));
    matrix.add(key);
    if (!hashPattern.test(row.source?.contentHash ?? "") || typeof row.source?.excerpt !== "string" || !row.source.excerpt.trim() || typeof row.source?.locator !== "string") diagnostics.push(issue("SOURCE_REFERENCE_INVALID", "Every case needs a synthetic source excerpt, locator, and SHA-256 hash.", "error", row.caseId));
  }
  for (const language of languages) for (const level of levels) for (const situation of situations) {
    if (!matrix.has(`${language}/${level}/${situation}`)) diagnostics.push(issue("DATASET_COVERAGE_INVALID", `Missing case for ${language}/${level}/${situation}.`));
  }

  const calibration = Array.isArray(splits?.calibration) ? splits.calibration : [];
  const holdout = Array.isArray(splits?.holdout) ? splits.holdout : [];
  const calibrationSet = new Set(calibration);
  const holdoutSet = new Set(holdout);
  if (calibration.length !== 12 || holdout.length !== 12) diagnostics.push(issue("SPLIT_SIZE_INVALID", "Calibration and holdout must each contain 12 case IDs."));
  for (const id of calibrationSet) if (holdoutSet.has(id)) diagnostics.push(issue("SPLIT_OVERLAP", `Case ${id} appears in both splits.`, "error", id));
  const assigned = new Set([...calibrationSet, ...holdoutSet]);
  for (const id of caseIds) if (!assigned.has(id)) diagnostics.push(issue("SPLIT_CASE_MISSING", `Case ${id} is not assigned to a split.`, "error", id));
  for (const id of assigned) if (!caseIds.has(id)) diagnostics.push(issue("SPLIT_CASE_UNKNOWN", `Split contains unknown case ${id}.`, "error", id));
  const byId = new Map(caseRows.map(row => [row.caseId, row]));
  for (const split of [calibration, holdout]) {
    const counts = { ru: 0, en: 0, beginner: 0, experienced: 0 };
    for (const id of split) {
      const row = byId.get(id);
      if (!row) continue;
      counts[row.language] += 1;
      counts[row.level] += 1;
    }
    if (counts.ru !== 6 || counts.en !== 6 || counts.beginner !== 6 || counts.experienced !== 6) diagnostics.push(issue("SPLIT_UNBALANCED", "Each split must be balanced across language and learner level."));
  }

  const labelRows = Array.isArray(labels) ? labels : [];
  const labelIds = new Set();
  for (const label of labelRows) {
    if (typeof label.caseId !== "string" || !caseIds.has(label.caseId) || labelIds.has(label.caseId)) {
      diagnostics.push(issue("LABEL_CASE_INVALID", "Labels must uniquely reference a known case.", "error", label.caseId));
      continue;
    }
    labelIds.add(label.caseId);
    if (label.status === "pending-review") diagnostics.push(issue("LABELS_PENDING_REVIEW", "Draft label has not been human-reviewed and cannot establish calibration agreement.", "warning", label.caseId));
    else if (label.status === "reviewed") {
      const caseRow = byId.get(label.caseId);
      if (typeof label.supportingExcerpt !== "string" || !label.supportingExcerpt.trim() || !caseRow?.source?.excerpt.includes(label.supportingExcerpt) || label.sourceUid !== caseRow.source.uid || label.locator !== caseRow.source.locator) {
        diagnostics.push(issue("REVIEW_EVIDENCE_MISSING", "Reviewed labels must cite an excerpt from the case source and its exact UID/locator.", "error", label.caseId));
      }
      const scored = scoreTeaching({ dimensions: label.dimensions, criticalFailures: label.criticalFailures ?? [] });
      for (const item of scored.diagnostics) diagnostics.push({ ...item, caseId: label.caseId });
    } else diagnostics.push(issue("LABEL_STATUS_INVALID", "Label status must be pending-review or reviewed.", "error", label.caseId));
  }
  for (const id of caseIds) if (!labelIds.has(id)) diagnostics.push(issue("LABEL_CASE_MISSING", `Case ${id} has no label record.`, "error", id));
  return diagnostics;
}

export async function runModelEval({ cases, provider, budgetUsd, maxCases, allowPaid = false, splits = {} } = {}) {
  if (allowPaid !== true) throw new Error("model evaluation requires explicit --allow-paid authorization");
  if (typeof budgetUsd !== "number" || !Number.isFinite(budgetUsd) || budgetUsd <= 0) throw new Error("a positive budget is required");
  if (!Number.isInteger(maxCases) || maxCases < 1) throw new Error("a positive max-cases limit is required");
  if (!provider || typeof provider.estimateCost !== "function" || typeof provider.runCase !== "function") throw new Error("a configured provider with estimateCost and runCase is required");
  if (!Array.isArray(cases) || !cases.length) throw new Error("no teaching cases were provided");
  const selected = cases.slice(0, maxCases);
  const estimates = selected.map(row => provider.estimateCost(row));
  if (estimates.some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error("judge cost is unknown; refusing paid evaluation");
  const estimatedCostUsd = estimates.reduce((sum, value) => sum + value, 0);
  if (estimatedCostUsd > budgetUsd) throw new Error("estimated judge cost exceeds the configured budget");

  const calibrationIds = new Set(splits.calibration ?? []);
  const holdoutIds = new Set(splits.holdout ?? []);
  const results = [];
  let actualCostUsd = 0;
  for (let index = 0; index < selected.length; index += 1) {
    const row = selected[index];
    const split = calibrationIds.has(row.caseId) ? "calibration" : holdoutIds.has(row.caseId) ? "holdout" : row.split;
    try {
      const response = await provider.runCase(row);
      if (response?.error) throw new Error(String(response.error));
      const score = scoreTeaching(response ?? {});
      const cost = response?.cost;
      if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) actualCostUsd += cost;
      const overBudget = actualCostUsd > budgetUsd;
      const agreement = overBudget ? undefined : agreementFor(response.dimensions, response.humanLabel);
      results.push({ caseId: row.caseId, split, status: overBudget ? "error" : "completed", ...(overBudget ? {} : { passed: score.passed, score: score.score, dimensions: response.dimensions, ...(typeof response.rationale === "string" ? { rationale: response.rationale } : {}), ...(agreement ? { agreement } : {}) }), diagnostics: overBudget ? [issue("BUDGET_EXCEEDED", "Reported provider cost exceeded the configured budget.", "error", row.caseId)] : score.diagnostics });
      if (overBudget) break;
    } catch (error) {
      results.push({ caseId: row.caseId, split, status: "error", diagnostics: [issue("JUDGE_ERROR", error instanceof Error ? error.message : "Judge failed.", "error", row.caseId)] });
    }
  }
  const calibration = results.filter(row => row.split === "calibration");
  const holdout = results.filter(row => row.split === "holdout");
  return {
    mode: "model-judge",
    budgetUsd,
    maxCases,
    estimatedCostUsd,
    actualCostUsd,
    results,
    calibration,
    holdout,
    ...(aggregateAgreement(calibration) ? { calibrationAgreement: aggregateAgreement(calibration) } : {}),
    ...(aggregateAgreement(holdout) ? { holdoutAgreement: aggregateAgreement(holdout) } : {}),
  };
}
