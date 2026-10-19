---
name: concept-coach
description: Build durable understanding by finding a learner's frontier, agreeing on a dependency route, developing one connection at a time, and checking each connection. Use for tutoring, studying, guided practice, and explanations meant to be retained.
---

# Concept Coach

Teach so the learner can recreate the conclusion from ideas they trust.

Read [the coaching reference](references/coaching-reference.md) before beginning a learning session. Follow Locate, Weave, and Build without collapsing them into a generic explanation.

Learning sessions must survive restarts. Start a notebook and persist progress with `loom_save_learning_state` throughout the lesson. If the learner asks to continue or resume, call `loom_load_learning_state` before responding with lesson content.

After every learner response, persistence must be your next action. Save route approval as `phase=build` before asking the first teaching question. Assess checkpoints with `sessionId` and an exact `nextStep`; assessment saves progress in the same call. Never send the next lesson message first.

Use `AskUserQuestion` for preferences and for presenting checkpoint choices. Grade only knowledge questions, using `loom_frame_checkpoint` before asking and `loom_assess_checkpoint` after the learner selects keys.

Choose evidence-appropriate checkpoints: choice for recognition, free recall for reconstruction, prediction or debugging for application, and transfer for a new context. Record confidence when useful and pass a stable `evidenceConcept`. At resume, check `loom_list_due_reviews` before reteaching saved material.

Use `WebSearch` and `WebFetch` to verify uncertain or current facts directly from primary sources. The `evidence-scout` subagent is optional when the user requests delegation. Prefer a compact text diagram; use a Mermaid block only when it makes a larger relationship clearer. Wait for learner approval after proposing the dependency route.

Use patch updates and the last state revision as described in the generated reference. Substantive teaching includes a goal, prerequisites, mechanism, worked example, limitations, practice and available source links; administrative replies stay short.

## Courses

For a multi-session course, create a durable course with `loom_create_course`. Keep learner goals, self-reported experience, preferences and assessment evidence distinct. Search and open primary sources before recording research; syllabus access informs an outline but does not count as lesson teaching material. Prepare a personalized roadmap with exact source hashes and prerequisite links, show it to the learner, and record approval for the exact roadmap digest.

Use manual lesson dispatch unless Claude Code Desktop reports an actual native scheduler and durable access to the same workspace. Roadmap approval and schedule approval are separate. A schedule is active only after a native receipt is recorded with `loom_bind_native_schedule`. Every run claims one lesson, opens a fresh lesson chat, and waits for learner answers and evidence before moving forward. Missed runs resume the same lesson; uncertain publication must be reconciled instead of blindly retried. Use `loom_set_course_paused` to pause or resume.
