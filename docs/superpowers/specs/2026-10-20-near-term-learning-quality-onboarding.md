# Learning Quality and Onboarding — Specification

**Status:** Draft for user review
**Scope:** Near-term learner-facing fixes; teacher mode is excluded and remains in backlog.
**Related:** [Foundation](2026-10-12-conceptloom-foundation.md), [platform design](2026-10-12-conceptloom-learning-platform-design.md), [evaluation plan](../plans/2026-10-12-conceptloom-evaluation.md).

## Goal

Make the promised lesson duration credible and help a new learner understand what they can ask ConceptLoom to do without learning tool names or commands.

## User outcomes

- A lesson sized for a stated time budget teaches enough before asking the learner to do most of the work.
- Its worked example prepares for the actual exercise; an unrelated short example cannot satisfy the lesson contract.
- After the learner responds, the coach gives a specific review before advancing or declaring completion.
- A new learner can start or continue a course, explore a topic, turn material into a note draft, or prepare for an assessment using ordinary language.

## Behavior and boundaries

1. A lesson includes a goal, relevant prerequisites, a causal/mechanistic explanation, a worked example aligned to the goal, limitations or uncertainty when material, learner practice, source references when source-grounded, and a next step.
2. Time estimates are planning budgets, not a minimum word count. The coach allocates time across instruction, example, learner work and review, and does not claim that learner work or a future response has already occurred.
3. When a requested lesson is short, the coach narrows scope transparently instead of presenting a tiny overview as a full session.
4. Administrative responses and simple clarifications remain concise; the lesson-depth rule applies to teaching sessions, not every chat response.
5. Routine practice uses short answer-choice questions by default, so the learner can respond with a selection. Long typed explanations are reserved for objectives that explicitly assess explanation or production.
6. Onboarding presents four natural-language examples: start a course, continue a course, make a note from material, and prepare/review. It explains the next action in plain language and asks only for information needed to proceed.
7. Onboarding and study requests cannot silently approve a roadmap, activate a schedule, change course progress, or overwrite notes. Those actions use existing consent and conflict-safe update flows.

## Acceptance criteria

- **LQ-1 Lesson contract:** Every full lesson plan identifies the objective, teaching time budget, example, learner practice and review; missing components are diagnosed before dispatch.
- **LQ-2 Depth matches scope:** A full lesson for a multi-step topic explains the key mechanism and its transitions; the example exercises the same objective as the practice.
- **LQ-3 Honest duration:** Time estimates distinguish coach instruction from learner response time. The lesson does not claim a timed segment was delivered when it was only assigned.
- **LQ-4 Evidence-based review:** Feedback refers to the learner's actual response, separates supported facts from assumptions, identifies omissions and proposes a next step. No feedback is fabricated before an answer exists.
- **LQ-5 Concise exception:** Greetings, tool confirmations and narrow factual clarifications do not expand into full lessons.
- **LQ-6 Low-friction practice:** A standard practice check can be answered without typing; written responses are brief and tied to an explicit learning objective.
- **OB-1 Understandable entry:** First-use guidance includes the four supported example requests and states what Loom will do next.
- **OB-2 Progressive questions:** The first turn asks for the learner's intended outcome; follow-ups are limited to missing inputs required for the selected workflow.
- **OB-3 Safe actions:** Note writes, roadmap approval and schedule activation remain explicit actions; onboarding text alone never implies they occurred.

## Test plan

- Prompt/contract tests: full lesson contains required sections; prompt inputs cannot inject new roles; source and objective are carried into the example and practice.
- Regression cases: 30-minute security lesson (including the supplied threat-model example), short clarification, source-conflict lesson, beginner and experienced learner, resume after interruption.
- Human-reviewed teaching rubric: mechanism, example alignment, level, grounding, limitations, practice, response-specific feedback and time-budget credibility. Critical failures include unsupported claims, unrelated worked examples, claiming a review before a response, and presenting a brief assignment as a completed full lesson.
- Onboarding flow tests: each example routes to the right workflow; missing course/topic/material prompts one useful follow-up; learner can use free-form wording; no state-changing operation is called without its existing consent.
- Acceptance review compares estimated segment durations with actual lesson content and labels uncertain timing as an estimate rather than a guarantee.

## Out of scope

Teacher lesson authoring, classroom management, learner cohorts and LMS exports. These remain backlog items.
