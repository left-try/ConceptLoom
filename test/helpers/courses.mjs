import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importSource } from "../../src/sources/import.mjs";
import { createCourse } from "../../src/courses/model.mjs";
import { recordCourseResearch } from "../../src/courses/research.mjs";
import { proposeRoadmap } from "../../src/courses/roadmap.mjs";
import { approveRoadmap, approveSchedule, draftSchedule } from "../../src/courses/approval.mjs";
import { indexKnowledge } from "../../src/knowledge/index.mjs";

export const COURSE_UID = "transactions-basics";
export const SOURCE_UID = "transactions-reference";
export const CONCEPT_UID = "transaction-isolation";

export async function makeWorkspace(t) {
  const root = await mkdtemp(join(tmpdir(), "concept-loom-courses-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

export async function addTeachingSource(root, options = {}) {
  const uid = options.uid ?? SOURCE_UID;
  const resource = options.resource ?? `https://example.test/${uid}/isolation`;
  const content = options.content ?? "Isolation levels define which concurrent changes a transaction can observe.";
  return importSource(root, {
    uid,
    resource,
    title: options.title ?? "Transaction isolation",
    language: "en",
    version: options.version ?? "1",
    coverage: options.coverage ?? "full",
    content,
    receipt: {
      query: "transaction isolation primary documentation",
      openedResource: options.openedResource ?? resource,
      representation: options.representation ?? "raw",
      coverage: options.coverage ?? "full",
      locators: [{ kind: "heading", value: "Isolation levels" }],
      limitations: options.limitations ?? [],
    },
  });
}

export function sourceBinding(source, overrides = {}) {
  return {
    sourceUid: source.uid,
    contentHash: source.currentContentHash,
    locator: {
      kind: "heading",
      value: "Isolation levels",
      contentHash: source.currentContentHash,
      ...overrides.locator,
    },
    role: overrides.role ?? "teaching",
    coverage: overrides.coverage ?? source.coverage,
  };
}

export function lesson(overrides = {}) {
  return {
    uid: overrides.uid ?? "isolation-levels",
    title: overrides.title ?? "Choose an isolation level",
    objectives: overrides.objectives ?? ["Explain the isolation trade-off", "Choose a level for a workload"],
    conceptUids: overrides.conceptUids ?? [CONCEPT_UID],
    prerequisiteLessonUids: overrides.prerequisiteLessonUids ?? [],
    sourceBindings: overrides.sourceBindings ?? [],
    exerciseUids: overrides.exerciseUids ?? ["choose-isolation"],
    estimatedMinutes: overrides.estimatedMinutes ?? 20,
    status: overrides.status ?? "pending",
  };
}

export async function createCourseDraft(root, options = {}) {
  const sources = options.sources ?? [await addTeachingSource(root)];
  const knowledgeRoot = join(root, "vault", "Knowledge");
  await mkdir(knowledgeRoot, { recursive: true });
  await writeFile(join(knowledgeRoot, "index.md"), '---\nokf_version: "0.2"\n---\n# Knowledge\n\nTest knowledge bundle.\n', "utf8");
  const conceptUids = options.conceptUids ?? [CONCEPT_UID];
  for (const uid of conceptUids) {
    await writeKnowledgeNote(root, `concepts/${uid}.md`, {
      type: "Concept",
      title: uid,
      uid,
      body: "A synthetic concept for deterministic course tests.",
    });
  }
  await indexKnowledge(root);
  const course = await createCourse(root, {
    uid: options.uid ?? COURSE_UID,
    topic: options.topic ?? "Database transactions",
    goal: options.goal ?? "Choose an isolation level for a small application",
    level: options.level ?? "intermediate",
    preferences: options.preferences ?? { language: "en", minutesPerWeek: 60 },
  });
  const researched = await recordCourseResearch(root, {
    courseUid: course.uid,
    expectedRevision: course.revision,
    sourceUids: sources.map(source => source.uid),
    receipts: sources.map(source => ({
      sourceUid: source.uid,
      canonicalResource: source.canonicalResource,
      contentHash: source.currentContentHash,
      coverage: source.coverage,
      receipt: source.receipt,
    })),
  });
  const roadmap = await proposeRoadmap(root, {
    courseUid: course.uid,
    expectedRevision: researched.revision,
    lessons: [lesson({
      conceptUids,
      sourceBindings: sources.map((source, index) => sourceBinding(source, { role: options.sourceRoles?.[index] ?? "teaching" })),
    })],
    adaptedFrom: options.adaptedFrom ?? [],
  });
  return { course: roadmap.course, readiness: roadmap.readiness, sources };
}

export async function createApprovedCourse(root, options = {}) {
  const draft = await createCourseDraft(root, options);
  const roadmapRevision = draft.course.roadmapRevision;
  const course = await approveRoadmap(root, {
    courseUid: draft.course.uid,
    roadmapRevision,
    consent: {
      recordedAt: "2026-10-13T10:00:00.000Z",
      host: options.host ?? "codex",
      userResponse: "I approve this course roadmap.",
      shownDigest: roadmapRevision,
    },
  });
  return { ...draft, course };
}

export async function createScheduleApprovedCourse(root, options = {}) {
  const approved = await createApprovedCourse(root, options);
  const draft = await draftSchedule(root, {
    courseUid: approved.course.uid,
    host: options.host ?? "codex",
    timezone: "Asia/Almaty",
    cadence: { kind: "weekly", weekdays: [1, 3, 5], interval: 1 },
    localTime: "09:00",
  });
  const scheduleApproval = await approveSchedule(root, {
    courseUid: approved.course.uid,
    draftId: draft.id,
    consent: {
      recordedAt: "2026-10-13T10:05:00.000Z",
      host: options.host ?? "codex",
      userResponse: "I approve this schedule.",
      shownDigest: draft.digest,
    },
  });
  return { ...approved, draft, scheduleApproval };
}

export async function writeAssessmentReceipt(root, { attemptId, courseUid, lessonUid }) {
  const path = join(root, ".concept-loom", "assessments", "attempts", `${attemptId}.json`);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify({
    schemaVersion: 1,
    attemptId,
    courseUid,
    lessonUid,
    outcome: "accurate",
    recordedAt: "2026-10-13T10:10:00.000Z",
  }), "utf8");
}

export async function writeKnowledgeNote(root, relativePath, { type, title, uid, body }) {
  const target = join(root, "vault", "Knowledge", relativePath);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, [
    "---",
    `type: ${type}`,
    `title: ${JSON.stringify(title)}`,
    "date: 2026-10-13",
    "conceptloom:",
    "  profile: conceptloom/1",
    `  uid: ${uid}`,
    "---",
    "",
    body,
    "",
  ].join("\n"), "utf8");
  return target;
}
