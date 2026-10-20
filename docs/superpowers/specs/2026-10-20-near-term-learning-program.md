# Near-Term Learning Program — Specification Index

**Status:** Draft for user review
**Decision:** Build the personal learning experience first. Teacher/classroom mode is backlog only.
**Purpose:** Order the near-term fixes and link their acceptance/test specifications; this index does not replace the existing phase specs.

## Product outcome

The learner can ask Loom for a goal-based course, study one lesson per chat, continue in a new chat, practise and get evidence-based feedback, return on a useful schedule, and connect durable notes to a provenance-backed Obsidian knowledge graph. Onboarding uses ordinary language. Lessons deliver the teaching depth their stated scope and duration imply. Diagrams and simulations help where they improve understanding and retain a text fallback.

## Work packages and dependencies

| Order | Work package | Specification | Depends on | Release evidence |
|---|---|---|---|---|
| 0 | Lesson quality and onboarding | [Learning quality and onboarding](2026-10-20-near-term-learning-quality-onboarding.md) | Existing OPF/Foundation contracts | Reviewed lesson cases; onboarding routes to real supported workflows |
| 1 | Durable course/lesson/chat continuity | [Course chat continuity](2026-10-20-course-chat-continuity.md) | Foundation persistence and Knowledge source contracts | Restart/new-chat recovery and evidence-gated completion |
| 2 | Scheduling, pause and review selection | [Scheduling and review policy](2026-10-20-scheduling-and-review-policy.md) | Course continuity and persisted assessment evidence | Consent/receipt checks, missed-run and review evidence matrix, host acceptance |
| 3 | Practice attempts and feedback | [Practice and feedback](2026-10-20-practice-and-feedback.md) | Foundation assessment/evidence; course/lesson identity | Durable attempt, privacy scan, rubric-reviewed feedback and resume test |
| 4 | Study companion and Obsidian graph | [Study companion and Obsidian graph](2026-10-20-study-companion-and-obsidian-graph.md) | Knowledge format/index/source provenance plus active course context | Vault navigation/edit/reindex acceptance and context-scope tests |
| 5 | Visual learning and simulations | [Visual learning and simulations](2026-10-20-visual-learning-and-simulations.md) | Practice attempt contract and graph/lesson links | Accessible diagram/text parity; deterministic simulation attempt lifecycle |

The existing technical dependency order remains **Foundation → Knowledge → Courses → Practice/UI → Evaluation**. Work package numbers communicate user-facing priorities; implementation plans must preserve that technical order and may deliver the lesson-quality/onboarding slice earlier where its existing prompt contracts allow it.

## Shared acceptance gates

- **G-1 No transcript dependency:** Course progress, attempts, approvals and next action survive process restart and chat change.
- **G-2 No false completion:** A scheduled run, generated lesson or elapsed time is not learning evidence.
- **G-3 Provenance and uncertainty:** Source-grounded claims link to exact content revision/locator; assumptions and unavailable material remain explicit.
- **G-4 Safe state changes:** Schedule activation, course edits and note writes use explicit consent/revision checks and preserve user-authored data.
- **G-5 Host parity by evidence:** Capability is checked per host; unsupported UI/scheduling uses a truthful fallback and is not recorded as passed.
- **G-6 Teaching quality:** Lesson duration/scope matches delivered instruction and practice; feedback is based on an actual learner response.
- **G-7 Privacy:** Hidden exercise criteria and unrelated learner state do not enter public artifacts, UI resources, vault exports or unrelated assistant context.

## Cross-package test plan

1. **Deterministic unit/contract suites:** Schema validation, lifecycle invariants, revision conflicts, idempotency, source provenance, graph stability and rendered public/private separation.
2. **Fault and restart suites:** Inject write failures, restart between dispatch/attempt/feedback, replay actions and run concurrent requests; no lost evidence, accidental advancement or duplicate external action.
3. **Teaching-quality regression set:** RU/EN, novice/experienced, short clarification/full lesson, source-grounded/security topic, incomplete answer, misconception, hint-assisted answer and resumed lesson. Human-reviewed rubric covers mechanism, example alignment, level, grounding, limitations, practice, feedback and honest time budget.
4. **Workflow acceptance:** Onboard → begin course → approve roadmap → start lesson in a fresh chat → leave it open → resume elsewhere → submit attempt → review feedback → return via schedule → record due review → continue course → save or link a note.
5. **Host UAT:** Verify new-chat/scheduled-chat behavior, durable workspace and available UI independently in every claimed host. Keep unsupported capability visible as unverified.
6. **Release gate:** Every case has a stable ID and explicit `pass|fail|error|skipped`; missing/error/skipped required evidence is not a pass. Evaluation does not alter learner mastery.

## Backlog only

**Teacher and classroom preparation mode:** authoring lectures and lesson plans for a defined audience, cohort/classroom management, instructor review workflows, class progress, LMS export and shared student graphs. Do not include these features, schemas or permissions in the near-term implementation packages. Revisit after the personal learner course→lesson→practice loop is accepted.

## Existing source documents

- [Foundation spec](2026-10-12-conceptloom-foundation.md)
- [Knowledge implementation plan](../plans/2026-10-12-conceptloom-knowledge.md)
- [Courses spec](2026-10-13-conceptloom-courses.md)
- [Practice implementation plan](../plans/2026-10-12-conceptloom-practice.md)
- [Platform design](2026-10-12-conceptloom-learning-platform-design.md)
