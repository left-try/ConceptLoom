# Practice Attempts and Feedback — Specification

**Status:** Draft for user review
**Scope:** Persisted learner attempts, specific feedback and evidence updates.
**Related:** [platform design](2026-10-12-conceptloom-learning-platform-design.md), [practice plan](../plans/2026-10-12-conceptloom-practice.md), [coaching reference](../../../shared/coaching-reference.md).

## Goal

Make practice a verifiable part of the lesson: capture what the learner actually did, provide actionable feedback, and update evidence without overstating mastery.

## Behavior and boundaries

- An exercise has stable UID/revision, lesson/objective links, public task, format, and private assessment criteria. Public artifacts, diagrams and HTML never expose private answers/rubrics before submission.
- Routine practice defaults to short single-choice questions answered by selection. Typed explanation is reserved for objectives that assess explanation or production; it is brief and its purpose is clear to the learner.
- An attempt records exact response or artifact hash, exercise revision, timestamp, hints, optional confidence, assessment method/version, criterion outcomes, feedback and next step.
- Submit and assess are distinct. Submission alone does not claim mastery; assessment references the submitted attempt. `attemptId` retries are idempotent and changed content under the same ID conflicts.
- Feedback responds to the actual answer: identify valid reasoning, missing or incorrect steps, separate fact from assumption, and offer a focused repair/transfer action. Do not reveal a full solution before the learner has attempted unless they ask for it or the exercise contract allows it.
- Routine practice defaults to short single-choice questions answerable by selection, with an explicit unsure option. Typed explanations are used selectively when explanation or production is itself the objective; they stay brief and their purpose is explained.
- Evidence distinguishes unaided retrieval, hint-assisted work, recognition, application and transfer. Preference/self-report and model confidence are not mastery evidence.
- If a host does not support a structured widget, text practice and explicit attempt export remain available.

## Acceptance criteria

- **PF-1 Attempt integrity:** Attempt is durably saved with exact exercise revision before feedback/next step; server restart and retry recover the same receipt.
- **PF-2 Privacy:** Private criteria/answers are absent from public lesson artifacts, notebook exports, graph, UI resources and learner-visible tool responses before assessment.
- **PF-3 Evidence distinction:** Hint-assisted or self-reported success cannot increment unaided retrieval; assessment method and rubric version are retained.
- **PF-4 Useful feedback:** Each assessed response yields criterion-level results, response-specific rationale and a next action; unsupported certainty is labeled.
- **PF-5 No double credit:** Duplicate attempt IDs are idempotent; reused IDs with altered response and attempts against stale exercise revisions are rejected without state changes.
- **PF-6 Format parity:** Text fallback and interactive view submit equivalent canonical attempt data.
- **PF-7 Recovery:** Failed persistence prevents progression and preserves the learner's ability to resubmit or reconcile.
- **PF-8 Low-friction practice:** The standard exercise path can be completed without typing; choices distinguish plausible misconceptions and feedback follows the selected choice. Written response is reserved for selected objectives that require it.

## Test plan

- Contract/schema tests for exercise revisions, attempt content, rubric version, evidence dimensions and private/public projection.
- Privacy tests place unique canary strings in private criteria and scan every public output path (MCP result, lesson export, notebook, HTML/resource, graph projection).
- Idempotency, stale revision, altered duplicate, concurrent submit and injected disk-failure tests.
- Feedback fixtures include correct-but-uncertain, partially correct, high-confidence misconception, hint-assisted answer, irrelevant response and transfer failure; human-reviewed rubric checks grounding and usefulness.
- Choice-first UX tests cover single selection, unsure answer, misconception-specific feedback, and typed response only on an explanation/production objective.
- Cross-format tests compare normalized submitted payload from terminal text, local HTML and supported MCP UI.
- End-to-end test verifies attempt persistence → feedback → evidence ledger update → review due date → resume in another chat.

## Out of scope

Arbitrary code execution. Coding labs remain disabled or explicitly unverified until an isolated executor contract and security review exist.
