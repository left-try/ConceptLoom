import * as model from "./model.mjs";
import * as research from "./research.mjs";
import * as roadmap from "./roadmap.mjs";
import * as approval from "./approval.mjs";
import * as dispatch from "./dispatch.mjs";
import * as host from "../hosts/scheduling.mjs";
import * as projections from "./projections.mjs";

const inputs = {
  loom_create_course: ["uid", "topic", "goal"], loom_get_course: ["uid"], loom_update_course: ["uid", "expectedRevision", "patch"], loom_update_profile: ["expectedRevision", "observations"],
  loom_record_course_research: ["courseUid", "expectedRevision", "sourceUids", "receipts"], loom_propose_roadmap: ["courseUid", "expectedRevision", "lessons"], loom_approve_roadmap: ["courseUid", "roadmapRevision", "consent"],
  loom_propose_course_edit: ["courseUid", "projectionHash", "proposal"], loom_export_course_projection: ["courseUid", "path", "expectedHash"], loom_import_course_projection_edit: ["courseUid", "path", "expectedHash"], loom_set_course_paused: ["courseUid", "paused", "expectedRevision"], loom_draft_schedule: ["courseUid", "host", "timezone", "cadence", "localTime"], loom_approve_schedule: ["courseUid", "draftId", "consent"],
  loom_claim_lesson: ["courseUid", "runId", "host"], loom_publish_lesson: ["leaseId", "runId", "artifact", "hostChatId"], loom_complete_lesson: ["courseUid", "lessonUid", "expectedRevision", "evidenceAttemptIds"],
  loom_prepare_native_schedule: ["courseUid", "approvalId", "capabilities"], loom_bind_native_schedule: ["courseUid", "approvalId", "receipt"], loom_reconcile_dispatch: ["runId", "outcome"],
};
const handlers = {
  loom_create_course: model.createCourse, loom_get_course: model.getCourse, loom_update_course: model.patchCourse, loom_update_profile: model.updateLearnerProfile,
  loom_record_course_research: research.recordCourseResearch, loom_propose_roadmap: roadmap.proposeRoadmap, loom_approve_roadmap: approval.approveRoadmap,
  loom_propose_course_edit: approval.proposeCourseEdit, loom_export_course_projection: projections.exportCourseProjection, loom_import_course_projection_edit: projections.importCourseProjectionEdit, loom_set_course_paused: approval.setCoursePaused, loom_draft_schedule: approval.draftSchedule, loom_approve_schedule: approval.approveSchedule,
  loom_claim_lesson: dispatch.claimLesson, loom_publish_lesson: dispatch.publishLesson, loom_complete_lesson: dispatch.completeLesson,
  loom_prepare_native_schedule: host.prepareNativeSchedule, loom_bind_native_schedule: host.bindNativeSchedule, loom_reconcile_dispatch: host.reconcileNativePublication,
};
function propertySchema(key) {
  if (["expectedRevision"].includes(key)) return { type: "integer", minimum: 0 };
  if (["paused"].includes(key)) return { type: "boolean" };
  if (["sourceUids", "evidenceAttemptIds"].includes(key)) return { type: "array", items: { type: "string" } };
  if (["patch", "observations", "receipts", "lessons", "consent", "proposal", "cadence", "artifact", "capabilities", "receipt"].includes(key)) return { type: "object" };
  return { type: "string" };
}
export function courseTools(root, { hostAdapter } = {}) {
  return Object.entries(inputs).map(([name, required]) => ({
    definition: { name, description: `ConceptLoom course operation: ${name}.`, inputSchema: { type: "object", required, properties: Object.fromEntries(required.map(key => [key, propertySchema(key)])) } },
    invoke: args => name === "loom_prepare_native_schedule"
      ? host.prepareNativeSchedule(root, args, hostAdapter)
      : name === "loom_bind_native_schedule"
        ? host.bindNativeSchedule(root, args, hostAdapter)
        : handlers[name](root, args),
  }));
}
