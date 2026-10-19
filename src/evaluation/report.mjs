function caseIdOf(record) { return record?.identity?.eventId ?? record?.caseId ?? record?.eventId; }

export function buildEvalReport({
  expectedCaseIds = [], results = [], datasetVersion = "unknown", evaluatorSetVersion = "unknown",
  promptDigest, sourceHashes = [], hostAcceptance = [], requiredHosts = [], pendingLabels = 0,
  teachingSplits = {},
} = {}) {
  const expected = [...expectedCaseIds];
  const rows = Array.isArray(results) ? results : [];
  const failures = [];
  const counts = { passed: 0, failed: 0, error: 0, skipped: 0, missing: 0 };
  const byId = new Map();
  for (const row of rows) {
    const id = caseIdOf(row);
    const list = byId.get(id) ?? [];
    list.push(row);
    byId.set(id, list);
  }
  for (const id of expected) {
    const matches = byId.get(id) ?? [];
    if (!matches.length) { counts.missing += 1; failures.push({ caseId: id, code: "CASE_MISSING" }); continue; }
    if (matches.length > 1) failures.push({ caseId: id, code: "CASE_DUPLICATE" });
    for (const row of matches) {
      const result = row.result ?? row;
      if (result.status === "error") { counts.error += 1; failures.push({ caseId: id, code: "CASE_ERROR" }); }
      else if (result.status === "skipped") { counts.skipped += 1; failures.push({ caseId: id, code: "CASE_SKIPPED" }); }
      else if (result.status === "completed" && result.passed === true) counts.passed += 1;
      else { counts.failed += 1; failures.push({ caseId: id, code: "CASE_FAILED" }); }
    }
  }
  for (const id of byId.keys()) if (!expected.includes(id)) failures.push({ caseId: id, code: "CASE_UNEXPECTED" });
  const accepted = new Map((Array.isArray(hostAcceptance) ? hostAcceptance : []).map(item => [item.host, item]));
  const hostEvidenceGaps = requiredHosts.filter(host => accepted.get(host)?.status !== "passed").map(host => ({ host, reason: accepted.has(host) ? accepted.get(host).status : "missing" }));
  if (!requiredHosts.length && !hostAcceptance.length) hostEvidenceGaps.push({ host: "all configured hosts", reason: "no manual host acceptance evidence supplied" });
  const versions = { dataset: datasetVersion, evaluatorSet: evaluatorSetVersion, ...(promptDigest ? { promptDigest } : {}), sourceHashes: [...sourceHashes].sort() };
  const criticalFailures = rows.flatMap(row => (row.result ?? row).diagnostics ?? []).filter(item => item.code === "CRITICAL_FAILURE");
  if (pendingLabels > 0) failures.push({ code: "LABELS_PENDING_REVIEW", count: pendingLabels });
  const finalPass = failures.length === 0 && expected.length > 0;
  const gate = { pass: finalPass, status: finalPass ? "pass" : "blocked", failures };
  const markdown = [
    "# ConceptLoom Evaluation Report",
    "",
    `Gate: **${gate.status.toUpperCase()}**`,
    `Cases: ${counts.passed} passed, ${counts.failed} failed, ${counts.error} errors, ${counts.skipped} skipped, ${counts.missing} missing.`,
    `Versions: dataset=${versions.dataset}; evaluator=${versions.evaluatorSet}; prompt=${versions.promptDigest ?? "not recorded"}.`,
    `Pending human labels: ${pendingLabels}.`,
    "",
    "## Release gate failures",
    "",
    ...(gate.failures.length ? gate.failures.map(item => `- ${item.caseId ? `${item.caseId}: ` : ""}${item.code}${item.count ? ` (${item.count})` : ""}`) : ["- None." ]),
    "",
    "## Case results",
    "",
    "| Case | Status | Diagnostics |",
    "|---|---|---|",
    ...expected.map(id => {
      const result = byId.get(id)?.[0]?.result ?? byId.get(id)?.[0];
      const status = !result ? "missing" : result.status === "completed" ? (result.passed ? "passed" : "failed") : result.status;
      const codes = (result?.diagnostics ?? []).map(item => item.code).join(", ") || "—";
      return `| ${id} | ${status} | ${codes} |`;
    }),
    "",
    "## Manual host evidence gaps",
    "",
    ...(hostEvidenceGaps.length ? hostEvidenceGaps.map(item => `- ${item.host}: ${item.reason}`) : ["- None recorded."]),
    "",
    "## Teaching evaluation splits",
    "",
    ...["calibration", "holdout"].map(split => {
      const detail = teachingSplits[split] ?? { expected: 0, completed: 0, pending: 0 };
      return `- ${split}: ${detail.completed}/${detail.expected} completed; ${detail.pending} cases pending evaluation.`;
    }),
    "",
  ].join("\n");
  return { summary: counts, versions, criticalFailures, hostEvidenceGaps, pendingLabels, teachingSplits, gate, markdown };
}
