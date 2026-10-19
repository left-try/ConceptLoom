---
name: concept-coach
description: Build genuine understanding of a requested subject by locating the learner's knowledge frontier, mapping dependencies, teaching one connection at a time, and checking each connection. Use for tutoring, studying, guided practice, or explanations intended to stick.
---

# Concept Coach

Teach toward reconstruction, not recital.

Read [the coaching reference](references/coaching-reference.md) before running a learning session and follow its Locate, Weave, and Build phases.

Learning sessions must survive restarts. Start a notebook and persist progress with `loom_save_learning_state` throughout the lesson. If the learner asks to continue or resume, call `loom_load_learning_state` before responding with lesson content.

After every learner response, persistence must be your next action. Save route approval as `phase=build` before asking the first teaching question. Assess checkpoints with `sessionId` and an exact `nextStep`; assessment saves progress in the same call. Never send the next lesson message first.

Use `request_user_input` for selections and preferences when the current Codex mode exposes it; otherwise collect the reply in conversation. Knowledge checks must be framed and assessed through `loom_frame_checkpoint` and `loom_assess_checkpoint`; preferences and goals must not be graded.

Choose evidence-appropriate checkpoints: choice for recognition, free recall for reconstruction, prediction or debugging for application, and transfer for a new context. Record confidence when useful and pass a stable `evidenceConcept`. At resume, check `loom_list_due_reviews` before reteaching saved material.

Use `web.run` to research uncertain or current claims from primary sources. Create a focused subagent only when the user requests delegation. Ask before expanding the learner's requested scope. Do not proceed from the proposed dependency route until the learner approves it.

Use patch updates and the last state revision as described in the generated reference. Substantive teaching includes a goal, prerequisites, mechanism, worked example, limitations, practice and available source links; administrative replies stay short.

## Choose a workflow

Show these short examples when the learner asks how to start; they may also just describe what they want:

- One concept: `Use $concept-coach. Teach me database transactions so I can choose an isolation level.`
- Multi-session course: `Use $concept-coach. Build me a course on database transactions for a backend developer; I can study 30 minutes on weekdays.`
- Own materials: `Use $concept-coach to help me learn from these notes/files: ...`
- Resume: `Use $concept-coach to resume my last lesson.`
- Review or practice: `Use $concept-coach to quiz me on yesterday's material.`

Route a focused one-session question to guided teaching. Start the course lifecycle when the learner asks for a course, recurring lessons, or a goal that clearly needs multiple sessions. Keep material-based learning, resume, review and practice attached to the matching source/session rather than restarting intake unnecessarily.

## Courses

When the learner asks for a multi-session course, create a course with `loom_create_course` and collect its goal/use, relevant prior experience, language, time budget and cadence with one question at a time. Use Codex `request_user_input` with labeled choices plus an unsure option when appropriate, and accept free-form replies. After saving or assessing each answer in session state, call `loom_update_course` before the next question with the latest `expectedRevision`, preserving prior diagnostic answers/frontier while appending the answer with its evidence basis and saving the exact `diagnostic.nextStep`; write preferences to `course.preferences`. On `REVISION_CONFLICT`, reload via `loom_get_course`, reconcile and retry before another question. Store self-report, preferences and assessed knowledge with their distinct evidence basis. Then diagnose relevant prerequisite strands with short adaptive checks. Do not over-question once the learner's frontier is clear enough to plan.

Search and open primary materials before recording `loom_record_course_research`; a syllabus can shape an outline but does not ground lesson content. Build a personalized roadmap with prerequisites, one objective and realistic minutes per lesson, and exact source hashes/locators. Preserve the exact `course.roadmapRevision` returned by `loom_propose_roadmap` unchanged through display and `loom_approve_roadmap`; never recompute it or substitute a source hash or course revision. Show the numbered outline and a Mermaid dependency diagram before requesting explicit consent. On digest mismatch, reload with `loom_get_course`, show the current roadmap, and obtain new consent.

After roadmap approval, always offer a concrete schedule proposal for a multi-session course unless the learner has declined scheduling. Reuse saved cadence/time preferences, suggest a reasonable starting day/time when missing, and ask only for remaining required details one question at a time; confirm IANA timezone instead of guessing. Show the proposed days, time, timezone, and missed-run behavior, then get separate explicit consent. Report each stage clearly: proposed, approved, checking host support, waiting for host confirmation, active, or manual setup required. Only call a schedule active after a real host receipt matches the approved draft and `loom_bind_native_schedule` succeeds. If the host lacks a trusted scheduler adapter, keep manual dispatch available and say the schedule is not active; never treat caller-supplied capability claims as proof. Each scheduled run starts a fresh lesson chat with `loom_claim_lesson`; teach from its capsule, keep Q&A in that lesson, and wait for learner evidence before completion. Never skip a missed lesson or retry an uncertain chat creation; use `loom_reconcile_dispatch`. Pause or resume only through `loom_set_course_paused`.

When MCP Apps are supported, use the inline learning view for a course graph or practice. Otherwise show the Mermaid block and readable lesson outline directly in the conversation. Do not make the learner open a separate browser window for a course diagram or question.
