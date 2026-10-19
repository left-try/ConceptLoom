# Concept Loom Course UX Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task-by-task. Keep each change isolated and do not overwrite unrelated working-tree edits.

**Goal:** Make course workflows, diagnosis, roadmap approval, diagrams, and schedule status clear and usable in Codex.

**Architecture:** Keep the MCP course state and approval contracts authoritative. Strengthen the OPF and Codex guidance around those contracts, render a course roadmap through the existing inline learning view, and present a schedule as active only after a real host confirmation has been verified. Mermaid and conversation text remain the fallback.

**Tech Stack:** Node.js 20+ ES modules, OPF/0.2 prompt catalog, MCP tools/resources, self-contained HTML/CSS/JavaScript learning view.

**Spec:** `docs/superpowers/specs/2026-10-16-conceptloom-course-ux-design.md`

## Global Constraints

- Primary interaction is the Codex conversation and its native question UI; do not require a separate browser window.
- Ask one question at a time and save each learner answer before asking the next.
- Preserve the exact `roadmapRevision` returned by `loom_propose_roadmap` through display and `loom_approve_roadmap`.
- A schedule is active only after a matching host receipt is verified and `loom_bind_native_schedule` succeeds.
- The existing uncommitted changes are user work; do not reset, clean, or revert them.
- Do not add or run automated tests as part of this plan. Use the manual acceptance walkthroughs below and report any unverified native-host behavior.

## Review Focus

1. **Ambiguous request:** a plain-language request may mean one explanation or a multi-session course. The user should see a short course path only when the request implies a course.
2. **Unknown or mixed learner frontier:** uncertainty and free-form answers must be accepted, saved, and used to adapt the next question without treating self-report as demonstrated mastery.
3. **Roadmap changes between display and approval:** an outdated digest must stop approval and require a refreshed roadmap and fresh consent.
4. **Missing or ambiguous scheduler confirmation:** unsupported capability, timeout, missing schedule ID, or mismatched receipt must never produce an “active” status.
5. **Unavailable inline renderer or incomplete roadmap graph:** Mermaid/text must remain usable if MCP App rendering is unavailable, and the graph must not omit lesson objectives, estimates, sources, or prerequisite edges from the accompanying outline.

---

### Task 1: Make the learning workflows and course diagnosis explicit

**Files:**
- Modify: `prompts/diagnose.opf.md`
- Modify: `prompts/plan-course.opf.md`
- Modify: `prompts/registry.yaml` only if workflow routing needs host-specific guidance there
- Modify: `adapters/codex/.codex/skills/concept-coach/SKILL.md`
- Modify: `adapters/codex/AGENTS.md`
- Generate from catalog: `shared/coaching-reference.md` and the four adapter `references/coaching-reference.md` files using `npm run build:prompts`

**Interfaces:**
- Consumes: current session state and the existing `loom_save_learning_state`, `loom_frame_checkpoint`, and `loom_assess_checkpoint` tools.
- Produces: named entry modes for one concept, a multi-session course, learning from materials, resume, review, and practice; a saved, one-question-at-a-time diagnostic sequence.

- [ ] Add brief invocation examples and mode-routing rules to the Codex skill. State that plain-language requests are valid and a clearly multi-session goal starts the course workflow.
- [ ] Update `diagnose.opf.md` to collect goal/use, language, time, and cadence separately from mastery evidence, then adapt short prerequisite checks to the learner's answers. Specify choice, unsure, and free-response use through the host's native question interface, with conversational fallback.
- [ ] Specify the persistence order: save each response and the exact next diagnostic item before presenting another question; accept unknown/unsure answers without grading them as mastery.
- [ ] Update the Codex workspace instructions to surface the `concept-coach` entrypoint and its workflow examples without changing unrelated tool policy.
- [ ] Regenerate all host references from `prompts/registry.yaml` with `npm run build:prompts`; inspect the generated diffs and keep generated files synchronized with their catalog source.
- [ ] Manual acceptance: start a plain-language single-concept request and a multi-session-course request; confirm they route differently. In the course flow, answer a choice, a free-form diagnostic, and “not sure”; confirm each answer is saved before the next question and later questions adapt.

### Task 2: Preserve roadmap approval identity and present a useful roadmap

**Files:**
- Modify: `prompts/plan-course.opf.md`
- Modify: `adapters/codex/.codex/skills/concept-coach/SKILL.md`
- Modify: `shared/coaching-reference.md` and generated adapter references via `npm run build:prompts` when catalog guidance changes
- Modify: `src/ui/views.mjs`
- Modify: `src/ui/tools.mjs` and `src/ui/resources.mjs` to advertise roadmap rendering
- Modify: `ui/learning-view/app.mjs`
- Modify: `ui/learning-view/index.html` and `ui/learning-view/styles.css` as needed to display roadmap details accessibly
- Modify: `src/courses/projections.mjs` only if the existing generated course projection is used in this flow and must include approved roadmap details

**Interfaces:**
- Consumes: `loom_propose_roadmap` response `{ course, readiness }`, course lessons with `uid`, `title`, `objectives`, `prerequisiteLessonUids`, `estimatedMinutes`, and `sourceBindings`, plus existing `loom_show_relation_map` and `loom_open_learning_view` tools.
- Produces: a human-readable roadmap outline, a Mermaid dependency fallback, and `viewData.roadmap = { courseUid, topic, goal, roadmapRevision, lessons: [{ uid, title, objectives, estimatedMinutes, prerequisiteLessonUids, sources: [{ sourceUid, title, contentHash, locator }] }] }` for the inline view. Source titles come from existing course research receipts; do not fabricate missing titles.

- [ ] Update the planning and Codex instructions to retain the exact `course.roadmapRevision` in the current turn and pass that unchanged as `roadmapRevision` to `loom_approve_roadmap`; never substitute a source content hash or course storage revision.
- [ ] Specify mismatch recovery: reload with `loom_get_course`, show the current roadmap, and request fresh consent; do not claim approval after an error.
- [ ] Show a numbered lesson outline with each objective, estimated minutes, dependency, and source title/locator before approval. Build a Mermaid flowchart from the same lesson data and accompany it with the outline so the diagram is not the only source of detail.
- [ ] Extend `buildLearningView(root, { courseUid, ... })` in `src/ui/views.mjs` to load the course and expose the `viewData.roadmap` shape defined above. Keep lesson order stable, use `prerequisiteLessonUids` to draw prerequisite edges, and omit private consent payloads, learner assessment data, and hidden exercise rubrics.
- [ ] Update the existing learning-view app to render course roadmap data as an accessible, responsive inline graph/list, including a visible fallback when graph layout is unavailable. Do not create or open a standalone browser page for the course flow.
- [ ] Keep the full digest in the approval call; a shortened label is display-only. Preserve bound source hashes in course state and lesson launch data.
- [ ] Manual acceptance: inspect an approved roadmap and confirm the outline and graph contain the same lessons/edges. Approve once with the displayed revision, then simulate a changed roadmap/stale revision and confirm the old approval is rejected and the user is asked to review the new version.

### Task 3: Make schedule proposal, confirmation, and fallback explicit

**Files:**
- Modify: `shared/hosts/codex-scheduling.md`
- Modify: `adapters/codex/.codex/skills/concept-coach/SKILL.md`
- Modify: `prompts/plan-course.opf.md` and/or `prompts/teach-lesson.opf.md` for the schedule handoff
- Modify: `src/hosts/scheduling.mjs` or `src/courses/tools.mjs` only if inspection shows an already configured trusted Codex host adapter can be wired without accepting caller-supplied capability claims

**Interfaces:**
- Consumes: `loom_draft_schedule`, `loom_approve_schedule`, `loom_prepare_native_schedule`, `loom_bind_native_schedule`, and `loom_reconcile_dispatch`.
- Produces: a separate learner-approved schedule draft, an observable status report, and either a verified active binding or actionable manual setup instructions.

- [ ] After roadmap approval, always offer a concrete schedule proposal unless the learner declined; reuse saved cadence/time preferences, suggest a starting day/time when missing, confirm rather than guess timezone, ask only for missing details one at a time, and obtain separate schedule consent.
- [ ] In Codex guidance, require observed scheduler capability and durable access to the same workspace before any native task attempt. Use the returned launch prompt and report each stage in ordinary language.
- [ ] Inspect the live tool-registry construction before changing scheduling code: standard `src/bridge.mjs` currently calls `createToolRegistry(workspace)` without a `hostAdapter`, while `prepareNativeSchedule` and `bindNativeSchedule` require host verification callbacks. Preserve fail-closed behavior unless a trusted adapter integration is actually available; never make caller-supplied booleans or receipts trusted.
- [ ] When trusted verification is unavailable, keep the approved course manually dispatchable and tell the learner the schedule is not active, with the exact manual setup/launch instruction. After a create attempt without a confirmed receipt, report “waiting for confirmation” or “not active,” never “scheduled.”
- [ ] Require an actual host schedule ID and matching timezone, workspace, fresh-chat behavior, execution scope, and creation time before binding. On ambiguous timeout, reconcile host state before retrying.
- [ ] Manual acceptance: complete a course setup with scheduler support unavailable and confirm the result is a schedule proposal plus manual fallback; then, where a real Codex scheduler is available, exercise successful creation and an ambiguous/unconfirmed creation, confirming only the receipt-backed case becomes active.

### Task 4: Keep diagrams and documentation consistent across host installs

**Files:**
- Modify: `docs/ru/learning-from-scratch.md`
- Modify: `docs/en/learning-from-scratch.md`
- Modify: `adapters/codex/AGENTS.md` and the Codex skill only for the final invocation and visualization examples
- Modify: `README.md` only if the current Quick Start does not explain the new workflow entry examples
- Generate: `dist/learning-view.html` with `npm run build:ui` if source UI files change

**Interfaces:**
- Consumes: the workflow, roadmap, and schedule behavior established by Tasks 1–3.
- Produces: concise user documentation that matches the installed skill and current Codex capabilities.

- [ ] Document the five workflow entry examples in Russian and English, and explain that a learner can also simply state their goal.
- [ ] Document Mermaid as the conversational fallback and the inline learning view as capability-dependent. Do not promise rendered HTML in a host that cannot show an MCP App inline.
- [ ] Explain that schedule consent creates a proposal, while activation depends on a real verified native scheduler receipt; include the manual path.
- [ ] Build the distributable learning view with `npm run build:ui` after UI source changes and inspect the generated artifact diff; do not overwrite unrelated generated or user-edited content.
- [ ] Manual acceptance: compare the Russian/English documentation, Codex skill, workflow examples, rendered roadmap, and schedule status language for consistency.

## Execution Notes

- The foundation worktree already contains extensive staged, unstaged, and untracked work. Before each task, inspect the exact files it will touch. Preserve existing edits and isolate commits to files changed for that task only.
- The schedule flow must not imply native support merely because the plan/draft was approved. The default MCP bridge lacks a trusted host adapter today; identify whether a real, supported Codex integration exists before attempting to activate a schedule.
- The learner-facing roadmap and approval digest are distinct: the roadmap revision identifies the exact plan, while source hashes identify teaching material versions. Keep both identities intact for their separate purposes.
- This plan intentionally includes manual acceptance steps only. Automated test creation and execution were not authorized in this turn.
