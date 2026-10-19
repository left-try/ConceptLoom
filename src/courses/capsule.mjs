export function buildResumeCapsule(course, lesson, { maxChars = 16000, promptDigest = "sha256:prompt-v1", profile } = {}) {
  const capsule = {
    courseUid: course.uid, lessonUid: lesson.uid, roadmapRevision: course.roadmapRevision,
    goal: course.goal, learnerContext: { ...(course.preferences ?? {}), ...(profile?.observations?.length ? { observations: profile.observations } : {}) }, currentStep: lesson.objectives?.[0] ?? lesson.title,
    sourceBindings: (lesson.sourceBindings ?? []).map(binding => ({ sourceUid: binding.sourceUid, contentHash: binding.contentHash, locator: binding.locator, role: binding.role })),
    nextStep: `Teach “${lesson.title}” with one example, then invite questions; wait for learner evidence.`,
    dueReviews: [], knowledgePaths: [], promptDigest,
  };
  let diagnostics = [];
  while (JSON.stringify(capsule).length > maxChars && capsule.learnerContext && Object.keys(capsule.learnerContext).length) {
    capsule.learnerContext = {};
    diagnostics.push({ code: "CAPSULE_CONTEXT_TRIMMED", message: "Optional learner context omitted to preserve mandatory resume instructions." });
  }
  if (JSON.stringify(capsule).length > maxChars) throw Object.assign(new Error("mandatory resume capsule exceeds configured limit"), { code: "CAPSULE_TOO_LARGE" });
  if (diagnostics.length) capsule.diagnostics = diagnostics;
  return capsule;
}
