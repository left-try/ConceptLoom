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
