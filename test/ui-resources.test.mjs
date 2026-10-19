import test from "node:test";
import assert from "node:assert/strict";
import { listUiResources, readUiResource } from "../src/ui/resources.mjs";
import { makePracticeWorkspace, privateCriteria } from "./helpers/practice.mjs";

test("learning view resource is registered and can be read as a self-contained public bundle", async t => {
  const root = await makePracticeWorkspace(t, {
    ".concept-loom/assessments/private.json": JSON.stringify(privateCriteria),
  });

  const resources = await listUiResources();
  const view = resources.find(resource => resource.uri === "ui://conceptloom/learning-view.html");

  assert.ok(view);
  const response = await readUiResource(view.uri);
  assert.equal(response.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.match(response.contents[0].text, /<!doctype html>/i);
  assert.doesNotMatch(response.contents[0].text, /private-answer-marker|private-rubric-marker/);
  assert.doesNotMatch(response.contents[0].text, /(?:src|href)=["']https?:/i);
});

test("reading an unknown UI resource returns a stable not-found error", async t => {
  const root = await makePracticeWorkspace(t);

  await assert.rejects(
    readUiResource("ui://conceptloom/not-registered.html"),
    error => error.code === "RESOURCE_NOT_FOUND",
  );
});

test("UI resource failure does not prevent building the text fallback", async t => {
  const root = await makePracticeWorkspace(t);
  const { buildLearningView } = await import("../src/ui/views.mjs");

  const result = await buildLearningView(root, {
    focusUid: "atomicity",
    capabilities: { mcpAppUi: false },
  });

  assert.equal(result.resourceUri, undefined);
  assert.match(result.textFallback, /atomicity/i);
});
