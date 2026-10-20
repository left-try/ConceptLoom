# Near-Term Learning Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a durable, course-aware personal learning loop with credible lessons, explicit onboarding, safe progression and schedules, evidence-based practice, editable Obsidian notes, and accessible diagrams/simulations.

**Architecture:** Keep the Node MCP core deterministic; host models conduct teaching and native scheduling. Markdown/OKF is the learner-visible knowledge base, private versioned state stores course progression and attempts, and each host chat is a replaceable session. This is an execution index: phase implementation details remain in the linked Foundation, Knowledge, Courses, Practice/UI and Evaluation plans; this plan adds the approved near-term requirements and their integration gates.

**Tech Stack:** Node.js >=20, ES modules, `node:test`, JSON/JSONL and Markdown/OKF; optional host-native scheduling and MCP Apps UI. No autonomous agent loop, internal scheduler, or arbitrary learner-code executor.

**Specs:** [Program index](../specs/2026-10-20-near-term-learning-program.md); [lesson quality/onboarding](../specs/2026-10-20-near-term-learning-quality-onboarding.md); [course/chat continuity](../specs/2026-10-20-course-chat-continuity.md); [scheduling/review](../specs/2026-10-20-scheduling-and-review-policy.md); [practice/feedback](../specs/2026-10-20-practice-and-feedback.md); [study companion/Obsidian graph](../specs/2026-10-20-study-companion-and-obsidian-graph.md); [visual learning](../specs/2026-10-20-visual-learning-and-simulations.md).

**Phase plans:** [Foundation](2026-10-12-conceptloom-foundation.md); [Knowledge](2026-10-12-conceptloom-knowledge.md); [Courses](2026-10-12-conceptloom-courses.md); [Practice/UI](2026-10-12-conceptloom-practice.md); [Evaluation](2026-10-12-conceptloom-evaluation.md). Preserve their detailed per-task test steps; this plan does not replace them.

## Global Constraints

- Preserve current MCP tool contracts and schema v1/v2 compatibility unless a reviewed migration says otherwise.
- Course state, assessment attempts, consent and schedule receipts are durable private state; authored notes and source provenance live in the workspace knowledge vault.
- Host chats are not the source of truth. No schedule run or elapsed time counts as learning evidence.
- Source claims preserve exact content hash and locator; unavailable or uncertain content stays explicit.
- Private exercise criteria never enter learner-visible output, notebook exports, graph projections or UI resources before assessment.
- Notes and course projections use revision/hash checks and preserve user-authored text and unknown metadata.
- Each host capability is verified independently. Unsupported scheduling/UI has an honest text/manual fallback.
- Teacher/classroom mode is backlog only. Arbitrary learner code execution is excluded from this program.

## Review Focus

1. **Course/assessment state lost across process or chat restart:** Foundation/Courses restart and recovery tests; a chat transcript is never required to recover the next action.
2. **A host retries an ambiguous external publish/schedule and duplicates work:** Course lease/receipt fault injection and host-scheduling idempotency tests.
3. **An unreviewed source or stale hash appears as verified learning material:** Knowledge provenance fixtures and course readiness blockers.
4. **Private grading criteria leak through UI, notes or assistant context:** Practice canary scans across every public projection and bounded-context tests.
5. **A short assignment is presented as a full lesson or model feedback claims completion prematurely:** Human-reviewed lesson cases and a short-clarification control case.

---

### Task 1: Complete Foundation — persistence, assessment, prompts and semantic diagrams

**Files:** Follow the exact F1–F5 file map in [Foundation implementation plan](2026-10-12-conceptloom-foundation.md); principal modules include `src/workspace.mjs`, `src/storage/`, `src/assessment-service.mjs`, `src/prompts/`, `prompts/`, `src/diagram-tools.mjs`, `src/evaluation/`.

**Interfaces:** Use the signatures and schema versions defined in the Foundation plan. In particular, storage resolves one stable workspace root, checkpoint assessment commits attempt + learning state + receipt, and semantic diagrams render validated nodes/edges with a text fallback.

- [ ] **1. Write/retain failing tests:** Execute F1–F5 tests from the linked plan, including `patch preserves omitted arrays`, `stale revision changes nothing`, `failed commit keeps card usable`, `same attempt returns receipt after restart`, `hinted success is not unaided retrieval`, `semantic nodes have consistent styles`, and `labels remain escaped text`.
- [ ] **2. Run:** Use the exact targeted commands in F1–F5 before implementing each task; expected result is red for the new assertion and green after its implementation.
- [ ] **3. Implement:** Complete F1–F5 in dependency order. Preserve legacy public tool names and add migration/fallback behavior only as specified in the approved Foundation spec.
- [ ] **4. Verify:** Run the Foundation gate and existing regression tests; inject storage failures and restart a fresh process before claiming state durability.
- [ ] **5. Commit:** Use the atomic commit boundaries and messages in the linked Foundation plan; do not include unrelated pre-existing workspace changes.

### Task 2: Complete Knowledge — source provenance, editable notes and graph index

**Files:** Follow K1–K5 in [Knowledge implementation plan](2026-10-12-conceptloom-knowledge.md): `src/knowledge/`, `src/sources/`, schemas, source/graph tests and user-facing learning-material docs.

**Interfaces:** Use the plan's `parseKnowledge`, `importSource`, `indexKnowledge`, `searchKnowledge`, `getKnowledgeNode`, `getNeighborhood`, `updateKnowledge` and `exportKnowledge` contracts. Graph indexes are derived; Markdown vault content remains authoritative and user-editable.

- [ ] **1. Write/retain failing tests:** Execute K1–K5 test cases, especially `unknown fields survive roundtrip`, `coverage does not imply full access`, `ambiguous wikilink is diagnostic`, `low quality page blocks evidence use`, `conflict preserves body`, and `OKF export omits Personal and private data`.
- [ ] **2. Run:** Run each K-task's targeted `node --test` command; optional Python/document converter checks run only when that optional dependency is configured.
- [ ] **3. Implement:** Complete K1–K5 in order. Keep originals immutable; index precise locators; do not overwrite edited note bodies on hash conflict.
- [ ] **4. Verify:** Rebuild index after moving/editing a vault; open the exported vault in Obsidian and navigate concept → source fragment → lesson. Check that manual note edits survive reindex/export.
- [ ] **5. Commit:** Use the Knowledge plan's per-task commit boundaries; do not add optional OCR dependencies as a requirement for normal learning.

### Task 3: Complete Courses — roadmap, separate lesson chats, recovery and native scheduling

**Files:** Follow C1–C5 in [Courses implementation plan](2026-10-12-conceptloom-courses.md): `src/courses/`, `src/hosts/`, course/schedule schemas, course prompts, adapters, and course/host tests.

**Interfaces:** Use existing plan contracts for `createCourse`, `proposeRoadmap`, approval, `claimLesson`, `publishLesson`, `completeLesson`, `prepareNativeSchedule`, `bindNativeSchedule` and reconciliation. Stable `courseUid`, `lessonUid`, roadmap revision and actual host receipts identify work across chats.

- [ ] **1. Add failing tests for approved continuity rules:** In `test/course-dispatch.test.mjs` add `fresh chat restores same open lesson`, `question does not advance lesson`, `completion requires eligible attempt ids`, `restart restores exact next step`, and `ambiguous host publication waits for reconciliation`. In `test/course-e2e.test.mjs` cover leaving a lesson open and resuming it from another host session.
- [ ] **2. Add failing tests for schedule/review selection:** In `test/host-scheduling.test.mjs` and course progression tests add `unfinished lesson outranks due review`, `bounded due review precedes new lesson`, `missed runs never skip`, `paused course is no-op`, and `schedule change requires matching renewed consent`. Evidence matrix covers unaided success, hint-assisted success and failure with expected review date.
- [ ] **3. Implement:** Complete C1–C5 from the linked Courses plan. Add the due-item selector at the course dispatch boundary; it may select only the three ordered categories in the Scheduling spec and must not mark review/lesson evidence itself. Resume capsules point to existing durable records and fit the configured size limit.
- [ ] **4. Verify:** Run `npm run test:courses`, then manually verify one fresh scheduled session and one cross-chat resume in each supported host. Record unsupported capability as unverified; never create a real external schedule during deterministic tests.
- [ ] **5. Commit:** Use C1–C5 commit boundaries; keep course state, host receipts and scheduler binding changes independently reviewable.

### Task 4: Improve lesson quality and learner onboarding

**Files:** Create `prompts/onboard.opf.md` and `test/onboarding.test.mjs`, `test/teaching-quality.test.mjs`; modify `prompts/teach-lesson.opf.md`, prompt registry/build outputs, `shared/coaching-reference.md`, generated primary host references, and `docs/ru/learning-from-scratch.md` / English equivalent. Evaluation fixtures are added in Task 7.

**Interfaces:** Reuse the Foundation prompt loader (`loadPrompt(id,inputs)`) and host-provided native Q&A. Onboarding prompt routes natural-language requests to supported existing workflows; it does not introduce a private command syntax or mutate course/notes/schedules.

- [ ] **1. Write failing tests:** `full lesson includes mechanism aligned example practice and review`, `example prepares for assigned exercise`, `time budget separates coach and learner time`, `short clarification stays concise`, `no review before learner response`, `onboarding offers four natural language routes`, `missing inputs ask one relevant follow-up`, and `onboarding does not approve or write state`.
- [ ] **2. Run:** `node --test test/onboarding.test.mjs test/teaching-quality.test.mjs`; expected failure identifies missing prompt requirements/fixtures.
- [ ] **3. Implement:** Amend teaching prompt with a scope-to-time budget, an aligned worked example, scaffolding before the main exercise, explicit distinction between assignment and delivered instruction, and post-answer review. Add onboarding examples for start, resume, note drafting and assessment preparation. Keep courtesy/administrative answers short.
- [ ] **4. Verify:** Run prompt build/check and targeted tests. Manually review the supplied 30-minute threat-model lesson against LQ-1…LQ-5 and keep a short factual clarification as a negative control.
- [ ] **5. Commit:** `feat: improve lesson depth and first-use guidance`.

### Task 5: Complete Practice — durable attempts and feedback, excluding code execution

**Files:** Follow P1–P3 in [Practice/UI implementation plan](2026-10-12-conceptloom-practice.md): `src/practice/`, schemas, `ui/learning-view/`, `src/ui/`, scenario templates and practice/UI tests. Do not execute P4 coding labs in this program.

**Interfaces:** Use `createExercise`, `submitPractice`, `assessPractice`, `buildLearningView`, and the scenario state/export contract from P1–P3. Attempts update the Foundation evidence ledger and course progress through their approved services only.

- [ ] **1. Add failing tests:** Add/extend `test/practice.test.mjs` with `feedback cites actual learner response`, `partially correct response identifies missing criterion`, `high confidence misconception suggests a counterexample`, `hinted success is not unaided`, `failed persistence does not advance course`, and `stale exercise revision leaves state unchanged`.
- [ ] **2. Run:** `node --test test/practice.test.mjs`; for UI/scenario tasks run the exact P2/P3 target commands in the linked plan.
- [ ] **3. Implement:** Complete P1 assessment and public/private separation, P2 text/HTML/MCP resource parity, P3 scenario and simulation templates. Feedback must return criterion-level results and a next step before lesson completion is eligible.
- [ ] **4. Verify:** Run privacy canary scans over MCP results, notebook/vault exports and UI resources. Submit the same fixture through text and interactive paths and compare canonical attempt payloads. Confirm unavailable optional UI does not block text practice.
- [ ] **5. Commit:** Use P1/P2/P3 commit boundaries. Coding executor, arbitrary shell and Python execution remain out of scope.

### Task 6: Add the course-aware study companion on top of Knowledge and Courses

**Files:** Create `prompts/study-companion.opf.md`, `test/study-companion.test.mjs`, and companion workflow documentation; modify `prompts/registry.yaml`, `src/knowledge/tools.mjs` only for missing read/proposal contracts, relevant host skill references, and note/course projection integration. Reuse K1–K5 rather than adding a second graph store.

**Interfaces:** Companion reads `getCourse`, `getKnowledgeNode`, `searchKnowledge` and `getNeighborhood`; proposed note/course changes call their existing explicit approval and conflict-safe update APIs. Add `buildStudyContext(root,{courseUid?,query,maxNodes=12,maxChars=16000})->Promise<StudyContext>` returning selected public course fields, relevant node IDs/edges, source locators, truncation diagnostics and a digest. The host model performs conversational teaching; the MCP core supplies bounded context and deterministic read/write operations only.

- [ ] **1. Write failing tests:** `active course context contains only relevant fields`, `unrelated course private state excluded`, `exploration does not mutate roadmap`, `note draft retains provenance`, `accepted note write preserves manual body`, `unaccepted suggestion writes nothing`, and `self report is not assessment evidence`.
- [ ] **2. Run:** `node --test test/study-companion.test.mjs test/knowledge-update.test.mjs`; expected failures cover missing prompt/context projection or existing write guard gaps.
- [ ] **3. Implement:** Add four workflows: explain a new topic at current frontier, connect it to the active course, draft notes from learner-provided material, and prepare retrieval/review. Use a bounded context capsule and proposals for graph/course edits; no autonomous crawler or implicit roadmap mutation.
- [ ] **4. Verify:** Test at least one in-course and one out-of-course question, a source-backed note proposal and an edited Obsidian note. Confirm provenance and user-authored body survive round trip.
- [ ] **5. Commit:** `feat: add course-aware study companion workflows`.

### Task 7: Prepare teaching-quality evaluation cases

**Files:** Follow E1–E3 in [Evaluation implementation plan](2026-10-12-conceptloom-evaluation.md); add cases to `evals/datasets/teaching.jsonl`, review labels/rubric and `test/eval-rubrics.test.mjs`.

**Interfaces:** Reuse the approved capture/eval contracts. Required event/case identity includes prompt digest, source hashes, course/lesson IDs where available, evaluator version and explicit result status. Evaluation never writes learner mastery.

- [ ] **1. Add failing evaluation cases:** 30-minute lesson with insufficient content, unrelated example, honest short clarification, response-specific feedback and fact-vs-assumption distinction. RU/EN and novice/experienced cases are represented.
- [ ] **2. Run:** Execute deterministic rubric/dataset validation; incomplete, pending-label and missing cases are not treated as passing evidence.
- [ ] **3. Implement:** Complete E1–E3 dataset/assertion/rubric tasks from the linked plan. Keep human labels pending until an actual reviewer provides them; don't use an unreviewed judge to declare lesson quality solved.
- [ ] **4. Verify:** Validate dataset IDs, splits and rubric thresholds. Paid/model grading remains disabled unless explicitly configured under the existing evaluation guardrails.
- [ ] **5. Commit:** Use E1–E3 boundaries; this task prepares the evidence set and does not claim the release gate passes.

### Task 8: Deliver visual learning and bounded simulations

**Files:** Follow semantic graph work in Foundation F4 and view/simulation work in Practice P2/P3; add `test/visual-learning.test.mjs` only for uncovered acceptance cases and update `docs/host-acceptance.md`.

**Interfaces:** Consume K3 graph neighborhoods, public course/lesson data and P1 exercise attempts. UI is optional and all views expose Mermaid/text fallback.

- [ ] **1. Add failing tests:** `graph neighborhood is bounded and reports truncation`, `text fallback describes same nodes and edges`, `seed and action sequence replay deterministically`, `prediction is captured before result reveal`, `invalid action is rejected`, and `simulation export matches canonical attempt payload`.
- [ ] **2. Run:** `node --test test/visual-learning.test.mjs test/diagrams.test.mjs test/scenarios.test.mjs`; expected failure identifies remaining semantic graph/simulation gaps.
- [ ] **3. Implement:** Use diagrams selectively for dependencies, process or system boundaries. Complete two bounded simulation templates through P3; do not implement a generic graph editor or arbitrary code runner.
- [ ] **4. Verify:** Check keyboard/text fallback, narrow and wide layout, hostile labels and privacy canaries; verify same seeded attempt in local HTML and supported host UI.
- [ ] **5. Commit:** `feat: add accessible visual lessons and deterministic simulations`.

### Task 9: Run the final evaluation and cross-host acceptance gate

**Files:** Complete E4 in [Evaluation implementation plan](2026-10-12-conceptloom-evaluation.md); update `docs/host-acceptance.md`, `docs/evaluation.md`, `README.md`, `docs/ru/README.md`, `CHANGELOG.md` only for verified behavior.

**Interfaces:** Consume final Foundation, Knowledge, Courses, Practice/UI and Task 7 teaching cases. The report identifies source/prompt/evaluator revisions, pass/fail/error/skipped counts, manual host evidence and remaining gaps.

- [ ] **1. Write failing tests:** Add `missing required case blocks release`, `host gap is not pass`, `evaluation never changes mastery`, and `source revision mismatch is inconclusive` in the E4 replay/report suite.
- [ ] **2. Run:** `node --test test/eval-replay.test.mjs`; expected failure on missing gate/report behavior.
- [ ] **3. Implement:** Complete E4 replay/report/CI tasks from the linked plan; deterministic replay remains the default and paid model evaluation is a separately configured action.
- [ ] **4. Verify:** Run `npm run verify`, offline evaluation and recorded-output evaluation. Perform explicit host UAT for each claimed native schedule/UI feature; report actual support matrix and unresolved cases.
- [ ] **5. Commit:** `feat: report reproducible learning quality and host acceptance`.

## Completion Gate

- [ ] All linked phase plans' required tests and the acceptance cases above pass; no unimplemented required item is reported as complete.
- [ ] New-chat recovery, unfinished-lesson scheduling, evidence-based review, feedback, Obsidian edit preservation and visual/text parity pass one end-to-end learner walkthrough.
- [ ] Evaluation has complete required case results and human-reviewed teaching labels; absent/error/skipped evidence is reported as a gap.
- [ ] User-facing documentation identifies unsupported host capabilities and optional integrations honestly.
- [ ] Teacher/classroom mode remains backlog and no code/schema/permission surface for it is added.
