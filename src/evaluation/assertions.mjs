const HASH = /^sha256:[a-f0-9]{64}$/;

function listFrom(collection, key) {
  const value = collection?.[key];
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.entries(value).map(([uid, item]) => ({ uid, ...item }));
  return [];
}

function diagnostic(code, message, severity = "error") {
  return { severity, code, message };
}

export function resolveCitations({ markdown, sourceManifest, knowledgeIndex } = {}) {
  const text = typeof markdown === "string" ? markdown : "";
  const citations = [...text.matchAll(/\[\[([^\]#]+)#([^\]]+)\]\]/g)];
  const references = [];
  const diagnostics = [];
  if (!citations.length && /\[[^\]]+\]/.test(text)) {
    diagnostics.push(diagnostic("CITATION_NOT_EVIDENCE", "A display label without a source UID and locator is not evidence."));
  }
  const manifestSources = new Map(listFrom(sourceManifest, "sources").map(source => [source.uid, source]));
  const indexSources = new Map(listFrom(knowledgeIndex, "sources").map(source => [source.uid, source]));
  for (const [, rawUid, rawLocator] of citations) {
    const sourceUid = rawUid.trim();
    const locator = rawLocator.trim();
    const source = manifestSources.get(sourceUid);
    const indexed = indexSources.get(sourceUid);
    if (!source || !indexed) {
      diagnostics.push(diagnostic("CITATION_SOURCE_UNKNOWN", `Citation source ${sourceUid} is not present in both the source manifest and Knowledge index.`));
      continue;
    }
    if (!HASH.test(source.contentHash ?? "") || source.contentHash !== indexed.contentHash) {
      diagnostics.push(diagnostic("SOURCE_HASH_MISMATCH", `Citation source ${sourceUid} does not resolve to the same valid content hash in both indexes.`));
      continue;
    }
    if (!source.locators?.includes(locator) || !indexed.locators?.includes(locator)) {
      diagnostics.push(diagnostic("CITATION_LOCATOR_UNKNOWN", `Citation locator ${locator} is not present in both source records.`));
      continue;
    }
    references.push({ sourceUid, locator, contentHash: source.contentHash });
  }
  if (citations.length && references.length !== citations.length && !diagnostics.length) {
    diagnostics.push(diagnostic("CITATION_UNRESOLVED", "One or more citations could not be resolved."));
  }
  return { references, diagnostics };
}

export function assertNoPrivateMarkers({ publicText, privateMarkers = [] } = {}) {
  const text = typeof publicText === "string" ? publicText : "";
  const leaked = privateMarkers.filter(marker => typeof marker === "string" && marker.length > 0 && text.includes(marker));
  return {
    passed: leaked.length === 0,
    diagnostics: leaked.map(() => diagnostic("PRIVATE_MARKER_EXPOSED", "A private marker was found in public output.")),
  };
}

export function evaluateKnowledgeLinks({ markdown, knownPaths = [] } = {}) {
  const known = new Set(knownPaths);
  const diagnostics = [];
  const pattern = /\[[^\]]*\]\(([^)]+)\)/g;
  for (const [, rawTarget] of String(markdown ?? "").matchAll(pattern)) {
    const target = rawTarget.split("#", 1)[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || known.has(target)) continue;
    diagnostics.push(diagnostic("BROKEN_OPTIONAL_LINK", `Optional link target ${target} is not in the available Knowledge paths.`, "warning"));
  }
  return { passed: true, diagnostics };
}

export function assertReleaseInvariants(results, expectedCaseIds) {
  const rows = Array.isArray(results) ? results : [];
  const expected = Array.isArray(expectedCaseIds) ? expectedCaseIds : [];
  const failures = [];
  const counts = new Map();
  for (const row of rows) counts.set(row.caseId, (counts.get(row.caseId) ?? 0) + 1);
  for (const id of expected) {
    const matches = rows.filter(row => row.caseId === id);
    if (!matches.length) failures.push({ caseId: id, code: "CASE_MISSING" });
    if (matches.length > 1) failures.push({ caseId: id, code: "CASE_DUPLICATE" });
    for (const row of matches) {
      if (row.status === "error") failures.push({ caseId: id, code: "CASE_ERROR" });
      else if (row.status === "skipped") failures.push({ caseId: id, code: "CASE_SKIPPED" });
      else if (row.status !== "completed" || row.passed !== true) failures.push({ caseId: id, code: "CASE_FAILED" });
    }
  }
  for (const row of rows) if (!expected.includes(row.caseId)) failures.push({ caseId: row.caseId, code: "CASE_UNEXPECTED" });
  return { pass: failures.length === 0, failures };
}

export function evaluateDeterministic(caseInput) {
  const caseId = caseInput?.caseId;
  const type = caseInput?.type;
  let passed = false;
  let diagnostics = [];
  if (type === "citation") {
    const result = resolveCitations(caseInput);
    passed = result.diagnostics.every(item => item.severity !== "error") && result.references.length > 0;
    diagnostics = result.diagnostics;
  } else if (type === "concealment") {
    const result = assertNoPrivateMarkers(caseInput);
    passed = result.passed;
    diagnostics = result.diagnostics;
  } else if (type === "knowledge-links") {
    const result = evaluateKnowledgeLinks(caseInput);
    passed = result.passed;
    diagnostics = result.diagnostics;
  } else if (type === "workflow") {
    const steps = caseInput.steps ?? [];
    const requiredOrder = caseInput.requiredOrder ?? [];
    let cursor = -1;
    for (const step of requiredOrder) {
      const next = steps.indexOf(step, cursor + 1);
      if (next < 0) {
        diagnostics.push(diagnostic("WORKFLOW_ORDER_INVALID", `Required workflow step ${step} is missing or out of order.`));
        break;
      }
      cursor = next;
    }
    passed = diagnostics.length === 0;
  } else {
    diagnostics.push(diagnostic("EVALUATOR_UNSUPPORTED_CASE", `Unsupported deterministic case type: ${String(type)}.`));
  }
  return [{
    caseId,
    evaluatorId: `structural/${type ?? "unknown"}`,
    evaluatorVersion: "1",
    status: "completed",
    passed,
    diagnostics,
  }];
}
