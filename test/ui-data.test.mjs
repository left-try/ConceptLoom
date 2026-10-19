import test from "node:test";
import assert from "node:assert/strict";
import { buildLearningView } from "../src/ui/views.mjs";
import { makePracticeWorkspace, privateCriteria } from "./helpers/practice.mjs";

test("learning view returns a bounded public graph and a text fallback", async t => {
  const root = await makePracticeWorkspace(t, {
    "vault/Knowledge/index.md": "---\nokf_version: \"0.2\"\n---\n# Knowledge\n",
  });

  const result = await buildLearningView(root, {
    focusUid: "atomicity",
    capabilities: { mcpAppUi: false },
    limit: 12,
  });

  assert.ok(result.viewData.nodes.length <= 12);
  assert.equal(typeof result.textFallback, "string");
  assert.match(result.textFallback, /atomicity/i);
  assert.equal(result.resourceUri, undefined);
});

test("view data never includes private assessment fields", async t => {
  const root = await makePracticeWorkspace(t, {
    ".concept-loom/assessments/private.json": JSON.stringify(privateCriteria),
  });

  const result = await buildLearningView(root, { focusUid: "atomicity" });

  assert.doesNotMatch(JSON.stringify(result.viewData), /private-answer-marker|private-rubric-marker|expected|criterionResults/);
});

test("graph labels are returned as data without executable markup", async t => {
  const hostileLabel = '<img src=x onerror="alert(1)">';
  const root = await makePracticeWorkspace(t, {
    "vault/Knowledge/index.md": "---\nokf_version: \"0.2\"\n---\n# Knowledge\n",
    "vault/Knowledge/concepts/hostile.md": `---\ntype: Concept\ntitle: ${JSON.stringify(hostileLabel)}\nconceptloom:\n  profile: conceptloom/1\n  uid: hostile-label\n---\nSafe body.\n`,
  });

  const result = await buildLearningView(root, {
    focusUid: "hostile-label",
  });

  const node = result.viewData.nodes.find(item => item.uid === "hostile-label");
  assert.equal(node.label, hostileLabel);
  assert.equal(node.html, undefined);
  assert.equal(node.script, undefined);
});
