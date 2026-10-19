import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hash = `sha256:${"a".repeat(64)}`;

async function api() {
  try { return await import("../src/evaluation/assertions.mjs"); }
  catch { return {}; }
}

test("a Markdown label without a source locator is not citation evidence", async () => {
  const { resolveCitations } = await api();
  assert.equal(typeof resolveCitations, "function");
  const result = resolveCitations({
    markdown: "The claim is supported [Chapter 1].",
    sourceManifest: { sources: [] },
    knowledgeIndex: { sources: [] },
  });
  assert.deepEqual(result.references, []);
  assert.ok(result.diagnostics.some(item => item.code === "CITATION_NOT_EVIDENCE"));
});

test("a footnote resolves only when source, locator, and content hash match", async () => {
  const { resolveCitations } = await api();
  assert.equal(typeof resolveCitations, "function");
  const source = { uid: "book-1", contentHash: hash, locators: ["page-12"] };
  const result = resolveCitations({
    markdown: "Mechanism [[book-1#page-12]].",
    sourceManifest: { sources: [source] },
    knowledgeIndex: { sources: [source] },
  });
  assert.deepEqual(result.references, [{ sourceUid: "book-1", locator: "page-12", contentHash: hash }]);
  assert.deepEqual(result.diagnostics, []);
});

test("a citation with a stale source hash is unresolved", async () => {
  const { resolveCitations } = await api();
  assert.equal(typeof resolveCitations, "function");
  const manifest = { sources: [{ uid: "book-1", contentHash: hash, locators: ["page-12"] }] };
  const index = { sources: [{ uid: "book-1", contentHash: `sha256:${"b".repeat(64)}`, locators: ["page-12"] }] };
  const result = resolveCitations({ markdown: "[[book-1#page-12]]", sourceManifest: manifest, knowledgeIndex: index });
  assert.deepEqual(result.references, []);
  assert.ok(result.diagnostics.some(item => item.code === "SOURCE_HASH_MISMATCH"));
});

test("a private rubric marker in a public artifact blocks release", async () => {
  const { assertNoPrivateMarkers } = await api();
  assert.equal(typeof assertNoPrivateMarkers, "function");
  const result = assertNoPrivateMarkers({ publicText: "Exercise: PRIVATE-RUBRIC-42", privateMarkers: ["PRIVATE-RUBRIC-42"] });
  assert.equal(result.passed, false);
  assert.ok(result.diagnostics.some(item => item.code === "PRIVATE_MARKER_EXPOSED"));
  assert.equal(JSON.stringify(result).includes("PRIVATE-RUBRIC-42"), false);
});

test("an unresolved optional Knowledge link is diagnostic without failing conformance", async () => {
  const { evaluateKnowledgeLinks } = await api();
  assert.equal(typeof evaluateKnowledgeLinks, "function");
  const result = evaluateKnowledgeLinks({ markdown: "[Optional reading](optional.md)", knownPaths: [] });
  assert.equal(result.passed, true);
  assert.ok(result.diagnostics.some(item => item.code === "BROKEN_OPTIONAL_LINK"));
});

test("error, skipped, missing, and duplicate cases cannot pass the structural release gate", async () => {
  const { assertReleaseInvariants } = await api();
  assert.equal(typeof assertReleaseInvariants, "function");
  const results = [
    { caseId: "case-1", status: "completed", passed: true },
    { caseId: "case-2", status: "error" },
    { caseId: "case-3", status: "skipped" },
    { caseId: "case-3", status: "completed", passed: true },
  ];
  const gate = assertReleaseInvariants(results, ["case-1", "case-2", "case-3", "case-4"]);
  assert.equal(gate.pass, false);
  assert.ok(gate.failures.some(item => item.code === "CASE_ERROR"));
  assert.ok(gate.failures.some(item => item.code === "CASE_SKIPPED"));
  assert.ok(gate.failures.some(item => item.code === "CASE_MISSING"));
  assert.ok(gate.failures.some(item => item.code === "CASE_DUPLICATE"));
});

test("structural dataset covers 24 stable cases across six domains", async () => {
  const ledger = JSON.parse(await readFile(new URL("./fixtures/contracts/ledger.json", import.meta.url), "utf8"));
  assert.equal(ledger.cases.length, 24);
  assert.equal(new Set(ledger.cases.map(row => row.id)).size, 24);
  const counts = ledger.cases.reduce((result, row) => {
    result[row.domain] = (result[row.domain] ?? 0) + 1;
    return result;
  }, {});
  assert.deepEqual(counts, {
    "opf": 4,
    "state-checkpoint": 4,
    "okf-roundtrip": 4,
    "source-citation": 4,
    "course-dispatch": 4,
    "practice-capture": 4,
  });
  assert.ok(ledger.cases.every(row => row.origin?.file && row.origin?.test));
});

test("structural suite executes all 24 assertions and detects expected negative cases", async () => {
  let runStructuralSuite;
  try { ({ runStructuralSuite } = await import("../scripts/eval-structural.mjs")); }
  catch { runStructuralSuite = undefined; }
  assert.equal(typeof runStructuralSuite, "function");
  const result = await runStructuralSuite();
  assert.equal(result.results.length, 24);
  assert.equal(result.results.filter(row => row.passed).length, 24);
  assert.ok(result.results.some(row => row.expectedOutcome === false && row.actualOutcome === false));
});
