import test from "node:test";
import assert from "node:assert/strict";
import { createToolRegistry } from "../src/tool-registry.mjs";
import { makeWorkspace } from "./helpers/courses.mjs";

const expectedNames = [
  "loom_create_course",
  "loom_get_course",
  "loom_update_course",
  "loom_update_profile",
  "loom_record_course_research",
  "loom_propose_roadmap",
  "loom_approve_roadmap",
  "loom_propose_course_edit",
  "loom_set_course_paused",
  "loom_draft_schedule",
  "loom_approve_schedule",
  "loom_claim_lesson",
  "loom_resume_course",
  "loom_publish_lesson",
  "loom_complete_lesson",
  "loom_prepare_native_schedule",
  "loom_bind_native_schedule",
  "loom_reconcile_dispatch",
];

test("registers every course lifecycle tool without replacing existing tools", async t => {
  const root = await makeWorkspace(t);
  const registry = await createToolRegistry(root);
  const names = registry.catalog.map(tool => tool.name);

  for (const name of expectedNames) assert.ok(names.includes(name), `missing ${name}`);
  for (const name of ["loom_frame_checkpoint", "loom_assess_checkpoint", "loom_save_learning_state", "loom_show_relation_map"]) {
    assert.ok(names.includes(name), `lost existing tool ${name}`);
  }
  assert.equal(names.length, new Set(names).size);
});

test("course tools reject malformed arguments without changing persisted course state", async t => {
  const root = await makeWorkspace(t);
  const registry = await createToolRegistry(root);
  await assert.rejects(registry.invoke("loom_create_course", { uid: "", topic: "", goal: "" }));
  await assert.rejects(registry.invoke("loom_get_course", { uid: "does-not-exist" }));
});

test("registers schemas that require optimistic revisions for mutating course operations", async t => {
  const root = await makeWorkspace(t);
  const registry = await createToolRegistry(root);
  for (const name of ["loom_update_course", "loom_record_course_research", "loom_propose_roadmap", "loom_set_course_paused"]) {
    const tool = registry.catalog.find(item => item.name === name);
    assert.ok(tool, `missing ${name}`);
    assert.ok(tool.inputSchema.required.includes("expectedRevision"), `${name} must require expectedRevision`);
  }
});

test("returns machine-readable errors for stale revisions and unavailable host capabilities", async t => {
  const root = await makeWorkspace(t);
  const registry = await createToolRegistry(root);
  await assert.rejects(
    registry.invoke("loom_set_course_paused", { courseUid: "missing", paused: true, expectedRevision: 0 }),
    error => typeof error.code === "string",
  );
  await assert.rejects(
    registry.invoke("loom_prepare_native_schedule", { courseUid: "missing", approvalId: "missing", capabilities: {} }),
    error => ["CAPABILITY_UNAVAILABLE", "COURSE_NOT_FOUND"].includes(error.code),
  );
});
