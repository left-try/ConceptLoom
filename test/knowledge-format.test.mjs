import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeKnowledge, parseKnowledge, serializeKnowledge, validateKnowledge } from "../src/knowledge/format.mjs";
import { makeWorkspace, note, rootIndex } from "./helpers/knowledge.mjs";

const fixtureRoot = fileURLToPath(new URL("./fixtures/knowledge/", import.meta.url));

const codes = diagnostics => diagnostics.map(item => item.code);

test("initializes the OKF bundle and Personal area idempotently", async t => {
  const root = await makeWorkspace(t);
  const first = await initializeKnowledge(root);
  const indexBefore = await readFile(join(first.bundleRoot, "index.md"), "utf8");
  const second = await initializeKnowledge(root);
  assert.equal(second.bundleRoot, first.bundleRoot);
  assert.equal(await readFile(join(second.bundleRoot, "index.md"), "utf8"), indexBefore);
  assert.match(indexBefore, /okf_version:\s*["']?0\.2/);
  assert.match(await readFile(join(first.bundleRoot, "log.md"), "utf8"), /^# .*\n/m);
  await readdir(join(first.vaultRoot, "Personal"));
});

test("initialization preserves existing user-authored notes byte for byte", async t => {
  const personal = "# My note\r\nKeep this body and newline.\r\n";
  const existing = note("Concept", "Existing", "Curated content.");
  const root = await makeWorkspace(t, {
    "vault/Personal/my-note.md": personal,
    "vault/Knowledge/concepts/existing.md": existing,
  });
  await initializeKnowledge(root);
  assert.equal(await readFile(join(root, "vault/Personal/my-note.md"), "utf8"), personal);
  assert.equal(await readFile(join(root, "vault/Knowledge/concepts/existing.md"), "utf8"), existing);
});

test("parses a typed OKF note and derives its ID from its path", () => {
  const parsed = parseKnowledge(note("Concept", "Vectors", "A vector has magnitude."), {
    path: "concepts/vectors.md", bundleRoot: "/workspace/vault/Knowledge",
  });
  assert.equal(parsed.node.id, "concepts/vectors");
  assert.equal(parsed.node.type, "Concept");
  assert.equal(parsed.node.title, "Vectors");
  assert.match(parsed.body, /magnitude/);
});

test("parses the hand-authored ConceptLoom profile fixture without losing aliases or custom metadata", async () => {
  const source = await readFile(join(fixtureRoot, "valid-concept.md"), "utf8");
  const parsed = parseKnowledge(source, { path: "concepts/linear-vectors.md", bundleRoot: "/workspace/vault/Knowledge" });
  assert.deepEqual(parsed.node.aliases, ["vector", "направленный отрезок"]);
  assert.equal(parsed.node.uid, "linear-vectors");
  assert.equal(parsed.document.get("custom_test_field").get("retained"), true);
  assert.match(parsed.body, /magnitude and direction/);
});

test("publishes a JSON Schema that accepts standard nodes without closing unknown OKF types", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/knowledge-node.schema.json", import.meta.url), "utf8"));
  const validate = new Ajv({ strict: false }).compile(schema);
  const base = {
    id: "concepts/vectors", path: "concepts/vectors.md", type: "Concept", title: "Vectors",
    aliases: [], sources: [], relations: [], bodyHash: "a".repeat(64),
  };
  assert.equal(validate(base), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...base, type: "FutureOKFType" }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...base, type: "" }), false);
});

test("requires type on ordinary bundle notes", () => {
  const parsed = parseKnowledge("---\ntitle: Untyped\n---\nBody\n", {
    path: "concepts/untyped.md", bundleRoot: "/workspace/vault/Knowledge",
  });
  assert.ok(codes(parsed.diagnostics).includes("OKF_TYPE_REQUIRED"));
});

test("applies reserved root index semantics but requires type on nested indexes", () => {
  const root = parseKnowledge(rootIndex, { path: "index.md", bundleRoot: "/workspace/vault/Knowledge" });
  const nested = parseKnowledge("# Nested navigation\n", { path: "concepts/index.md", bundleRoot: "/workspace/vault/Knowledge" });
  assert.equal(codes(root.diagnostics).includes("OKF_TYPE_REQUIRED"), false);
  assert.ok(codes(nested.diagnostics).includes("OKF_TYPE_REQUIRED"));
});

test("validates reserved log date headings", () => {
  const valid = parseKnowledge("# Log\n\n## 2026-10-13\n- Imported a source.\n", {
    path: "log.md", bundleRoot: "/workspace/vault/Knowledge",
  });
  const invalid = parseKnowledge("# Log\n\n## Yesterday\n- Changed something.\n", {
    path: "log.md", bundleRoot: "/workspace/vault/Knowledge",
  });
  assert.equal(codes(valid.diagnostics).includes("OKF_LOG_DATE_REQUIRED"), false);
  assert.ok(codes(invalid.diagnostics).includes("OKF_LOG_DATE_REQUIRED"));
});

test("accepts the official OKF 0.2 marker only in the bundle root index", () => {
  const parsed = parseKnowledge(rootIndex, { path: "index.md", bundleRoot: "/workspace/vault/Knowledge" });
  const nested = parseKnowledge("---\nokf_version: '0.2'\n---\n# Index\n", {
    path: "concepts/index.md", bundleRoot: "/workspace/vault/Knowledge",
  });
  assert.equal(codes(parsed.diagnostics).includes("OKF_INVALID_INDEX_METADATA"), false);
  assert.ok(codes(nested.diagnostics).includes("OKF_INVALID_INDEX_METADATA"));
});

test("preserves unknown metadata, unknown node types, and body through serialization", () => {
  const source = note("LabNotebook", "Personal experiment", "Keep every paragraph.\nSecond paragraph.",
    "custom_vendor_field:\n  nested: true\n  labels: [a, b]\n");
  const parsed = parseKnowledge(source, { path: "custom/lab.md", bundleRoot: "/workspace/vault/Knowledge" });
  const serialized = serializeKnowledge(parsed, { metadataPatch: { title: "Renamed" } });
  const roundTrip = parseKnowledge(serialized, { path: "custom/lab.md", bundleRoot: "/workspace/vault/Knowledge" });
  assert.equal(roundTrip.node.type, "LabNotebook");
  assert.equal(roundTrip.node.id, "custom/lab");
  assert.equal(roundTrip.node.title, "Renamed");
  assert.match(serialized, /custom_vendor_field:/);
  assert.match(roundTrip.body, /Keep every paragraph\.\nSecond paragraph\./);
});

test("does not change the OKF path-derived ID when title or ConceptLoom UID changes", () => {
  const parsed = parseKnowledge(note("Concept", "Old title", "Body.",
    "conceptloom:\n  profile: conceptloom/1\n  uid: vector-1\n"), {
    path: "concepts/vector.md", bundleRoot: "/workspace/vault/Knowledge",
  });
  const updated = parseKnowledge(serializeKnowledge(parsed, {
    metadataPatch: { title: "New title", conceptloom: { profile: "conceptloom/1", uid: "stable-vector" } },
  }), { path: "concepts/vector.md", bundleRoot: "/workspace/vault/Knowledge" });
  assert.equal(updated.node.id, "concepts/vector");
  assert.equal(updated.node.uid, "stable-vector");
});

test("keeps OKF verified status independent from learner mastery", () => {
  const parsed = parseKnowledge(note("Concept", "Verified concept", "Evidence-backed note.",
    "verified: true\nstatus: stable\nconceptloom:\n  profile: conceptloom/1\n  uid: verified\n  mastery: missing\n"), {
    path: "concepts/verified.md", bundleRoot: "/workspace/vault/Knowledge",
  });
  const roundTrip = parseKnowledge(serializeKnowledge(parsed), {
    path: "concepts/verified.md", bundleRoot: "/workspace/vault/Knowledge",
  });
  assert.equal(roundTrip.node.verified, true);
  assert.equal(roundTrip.node.conceptloom.mastery, "missing");
});

test("reports profile relation errors separately from standard OKF conformance", () => {
  const parsed = parseKnowledge(note("Concept", "Broken relation", "Body.",
    "conceptloom:\n  profile: conceptloom/1\n  uid: invalid uid\n  relations:\n    - kind: teaches\n      target: /outside.md\n"), {
    path: "concepts/broken.md", bundleRoot: "/workspace/vault/Knowledge",
  });
  const standard = validateKnowledge(parsed);
  const profile = validateKnowledge(parsed, { strictProfile: true });
  assert.equal(standard.some(item => item.severity === "error" && item.code.startsWith("CL_")), false);
  assert.ok(profile.some(item => item.severity === "error" && item.code.startsWith("CL_")));
});

test("invalid YAML yields diagnostics and cannot be serialized as a clean note", () => {
  const parsed = parseKnowledge("---\ntype: Concept\ntitle: [broken\n---\nDo not lose this text.\n", {
    path: "concepts/broken.md", bundleRoot: "/workspace/vault/Knowledge",
  });
  assert.ok(parsed.diagnostics.some(item => item.severity === "error"));
  assert.throws(() => serializeKnowledge(parsed, { metadataPatch: { title: "Overwrite" } }), /invalid|yaml|diagnostic/i);
});

test("duplicate YAML keys are an error instead of silently selecting one value", async () => {
  const source = await readFile(join(fixtureRoot, "invalid-duplicate-key.md"), "utf8");
  const parsed = parseKnowledge(source, { path: "concepts/duplicate.md", bundleRoot: "/workspace/vault/Knowledge" });
  assert.ok(parsed.diagnostics.some(item => item.severity === "error"));
  assert.throws(() => serializeKnowledge(parsed, { metadataPatch: { title: "Replacement" } }), /duplicate|yaml|invalid/i);
});

test("validateKnowledge returns no errors for an official-style node", () => {
  const parsed = parseKnowledge(note("Reference", "Primary source", "Description.",
    "resource: https://example.test/book\nstatus: stable\nsources: []\n"), {
    path: "references/primary-source.md", bundleRoot: "/workspace/vault/Knowledge",
  });
  assert.equal(validateKnowledge(parsed).filter(item => item.severity === "error").length, 0);
});
