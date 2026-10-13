import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { convertDocument } from "../src/sources/document-adapter.mjs";
import { importSource } from "../src/sources/import.mjs";
import { makeWorkspace } from "./helpers/knowledge.mjs";

const python = process.env.CONCEPTLOOM_PYTHON ?? "python";
const pythonAvailable = spawnSync(python, ["--version"], { encoding: "utf8" }).status === 0;

function syntheticPdf(text) {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET\n`;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    `5 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}endstream\nendobj\n`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += object;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

async function sourceFixture(t, text = "Synthetic source fixture, never overwrite this original.") {
  const root = await makeWorkspace(t);
  const bytes = syntheticPdf(text);
  const localFile = join(root, "synthetic.pdf");
  await writeFile(localFile, bytes);
  const source = await importSource(root, {
    uid: "document-fixture", resource: "file:///synthetic-document", title: "Synthetic document",
    coverage: "full", localFile, receipt: {
      schemaVersion: 1, query: "synthetic document", openedResource: "file:///synthetic-document",
      fetchedAt: "2026-10-13T08:00:00.000Z", representation: "raw", coverage: "full",
      contentHash: createHash("sha256").update(bytes).digest("hex"), limitations: [],
    },
  });
  const assetPath = source.versions[0].assetPath;
  const original = resolve(root, "vault/Knowledge", assetPath);
  return { root, source, original };
}

async function textSourceFixture(t) {
  const root = await makeWorkspace(t);
  const content = "A vector has magnitude and direction.\fThe eig\uFFFDnvector needs review.\fA matrix maps vectors.\n";
  const source = await importSource(root, {
    uid: "text-page-fixture", resource: "file:///synthetic-pages.txt", title: "Synthetic pages",
    coverage: "full", content, receipt: {
      schemaVersion: 1, query: "synthetic pages", openedResource: "file:///synthetic-pages.txt",
      fetchedAt: "2026-10-13T08:00:00.000Z", representation: "raw", coverage: "full",
      contentHash: createHash("sha256").update(content).digest("hex"), limitations: [],
    },
  });
  return { root, source };
}

test("reports an actionable error when the configured Python worker is unavailable", async t => {
  const { root, source } = await sourceFixture(t);
  await assert.rejects(convertDocument(root, {
    sourceUid: source.uid, pythonExecutable: "conceptloom-no-such-python-worker", timeoutMs: 500,
  }), error => error.code === "CONVERTER_UNAVAILABLE" && /python|converter|install/i.test(error.message));
});

test("rejects an unknown source before starting a worker", async t => {
  const root = await makeWorkspace(t);
  await assert.rejects(convertDocument(root, { sourceUid: "missing-source", pythonExecutable: "python" }), /source|manifest|unknown/i);
});

test("records per-page quality status and concrete diagnostics in prepared source output", async t => {
  if (!pythonAvailable) return t.skip("Python runtime unavailable for converter integration");
  const { root, source } = await sourceFixture(t);
  let result;
  try {
    result = await convertDocument(root, {
      sourceUid: source.uid, pythonExecutable: python,
      ocrMode: "auto", languages: ["en", "ru"], timeoutMs: 120000,
    });
  } catch (error) {
    if (error.code === "CONVERTER_UNAVAILABLE") return t.skip(`optional document engine unavailable: ${error.message}`);
    throw error;
  }
  assert.ok(result.pages.length > 0);
  for (const page of result.pages) {
    assert.ok(["usable", "needs-review", "failed"].includes(page.quality.status));
    assert.ok(Array.isArray(page.quality.signals));
    assert.equal(typeof page.contentHash, "string");
    assert.equal(typeof page.locator.page, "number");
    assert.equal(Object.hasOwn(page.quality, "confidence"), false);
  }
});

test("does not change source bytes when conversion times out", async t => {
  if (!pythonAvailable) return t.skip("Python runtime unavailable for timeout integration");
  const { root, source, original } = await sourceFixture(t);
  const path = resolve(root, original);
  const before = await readFile(path);
  let failure;
  try {
    await convertDocument(root, { sourceUid: source.uid, pythonExecutable: python, timeoutMs: 1 });
  } catch (error) { failure = error; }
  if (failure?.code === "CONVERTER_UNAVAILABLE") return t.skip(`optional document engine unavailable: ${failure.message}`);
  assert.ok(failure, "conversion must time out");
  assert.ok(failure.code === "CONVERTER_TIMEOUT" || /timeout/i.test(failure.message));
  assert.deepEqual(await readFile(path), before);
});

test("resume reprocesses only failed or needs-review pages and keeps old locators version-bound", async t => {
  if (!pythonAvailable) return t.skip("Python runtime unavailable for resume integration");
  const { root, source } = await textSourceFixture(t);
  const first = await convertDocument(root, { sourceUid: source.uid, pythonExecutable: python, ocrMode: "auto" });
  const retryable = first.pages.filter(page => page.quality.status !== "usable").map(page => page.locator.page);
  assert.deepEqual(retryable, [2]);
  const second = await convertDocument(root, {
    sourceUid: source.uid, pythonExecutable: python, ocrMode: "auto", resumeFrom: first.resumeFrom,
  });
  assert.deepEqual(second.processedPages, retryable);
  assert.ok(second.pages.every(page => page.contentHash === first.contentHash));
});
