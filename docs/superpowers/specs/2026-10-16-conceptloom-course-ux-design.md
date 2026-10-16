# Concept Loom: course workflow UX design

Date: 16 October 2026. Status: design approved by the user; specification awaiting review. This document defines intended behavior; it does not claim implementation or verification.

## Goal

Make Concept Loom's multi-session course flow predictable and comfortable in Codex: learners can see how to start each workflow, answer a useful adaptive diagnosis, review and approve the exact roadmap revision, understand schedule setup and its current status, and inspect the course structure through readable diagrams.

The primary interface is the conversation and Codex's native question UI. A separate browser window is not part of the learner flow. Rich HTML may be used only through an available inline MCP App renderer; otherwise use Mermaid in the conversation and plain text where Mermaid cannot render.

## User-facing workflows

The `concept-coach` entry instructions must show concise invocation examples and route requests to named modes:

- **Learn one concept:** focused, single-session teaching.
- **Build a course:** goal, diagnosis, research, roadmap, approval, then lessons.
- **Learn from materials:** use supplied books, notes, code, or course materials and report access coverage accurately.
- **Resume a lesson:** load saved state and continue the existing lesson.
- **Review or practise:** retrieve due knowledge or work through an exercise.

Examples must make clear that the learner can simply describe their goal without memorizing a command. A request for a multi-session course must not silently become a single explanation.

## Guided diagnosis

For a multi-session course, collect the goal and intended use, relevant prior experience, language, available time, and preferred cadence. Then use short knowledge checks to establish a demonstrated frontier across relevant prerequisite strands. Keep self-reported experience and preferences separate from evidence of mastery.

In Codex, ask one question at a time through `request_user_input` when available. Use concise labeled choices (A, B, C, and so on), include an unsure/unknown choice when useful, and allow a free-form reply. Use open-response checks when recall or explanation is better evidence than recognition. If the native question interface is unavailable, ask the same single question in the conversation. Persist each answer before presenting the next question; the saved state must identify which diagnostic item is next.

Ask enough questions to make the route meaningfully personal, adapting the checks to the learner's answers and the subject's prerequisite strands. Do not impose a fixed long questionnaire when earlier answers already establish the needed frontier. Explain briefly why a question matters when it may feel unexpected.

## Roadmap and approval integrity

The roadmap shown to the learner must include an ordered set of lessons, prerequisite relationships, a testable objective and realistic duration for each lesson, and the source(s) that support teaching it. Show a concise Mermaid dependency diagram when it helps clarify the sequence; retain a readable text list as the authoritative lesson outline.

Preserve the exact `roadmapRevision` returned by `loom_propose_roadmap` through display and the `loom_approve_roadmap` call. Do not omit, regenerate, normalize, or replace it with a source hash, course revision, or shortened display label. Consent must be bound to the exact displayed roadmap digest. If the roadmap changes or approval reports a digest mismatch, stop, reload the current course, present the changed roadmap, and request fresh consent. Do not report approval until the tool confirms it.

The full revision digest remains available to the approval flow. The learner-facing roadmap may display a short version label for orientation, alongside a clear statement that approval applies only to the displayed revision. Source citations should include useful titles and locators; source content hashes remain intact in course state and teaching bindings.

## Schedule proposal and status

After the roadmap is approved, offer a separate schedule proposal where course cadence is relevant. Ask the learner to choose or provide frequency, days, local time, and timezone through the same native single-question interface. Summarize the proposed schedule, missed-run behavior, and the rule that the next lesson waits for learner evidence before advancing. Schedule consent is separate from roadmap consent.

Explain the stages in ordinary language: **proposal**, **approved**, **checking host support**, **waiting for host confirmation**, **active**, or **manual setup required**. Use the observed host capabilities and the existing native-schedule tools. If the host cannot start fresh scheduled chats with durable workspace access, provide the manual setup instructions and keep the course available for manual lesson dispatch. Only say the schedule is active after the host returns a matching receipt and `loom_bind_native_schedule` succeeds. If setup is attempted but not confirmed, state that it is not active and explain the next action. Never imply that a draft or consent alone created a running schedule.

## Diagrams and inline presentation

Prefer Mermaid for course order, prerequisites, and concept relationships, using concise labels and one idea per diagram. Use the existing interactive learning-view MCP App for richer graph or practice presentation only when the host confirms inline MCP App support. Do not send learners to a separate browser tab to complete course setup or answer diagnosis questions. When the renderer is absent or unsuitable, include a Mermaid block or a compact text fallback directly in the conversation.

## Scope and implementation boundary

This change updates the shared coaching guidance and OPF course prompts, the Codex adapter entry instructions, and the course presentation/approval/scheduling handoff only where needed to enforce this behavior. Preserve the portable behavior of other host adapters; adapt their question mechanism to their native interaction tool and retain their text fallback. Do not add a standalone web application or a new scheduler backend.

The current project contains substantial uncommitted work. Implementation must inspect and preserve that work, edit only the files needed for this design, and keep any eventual commit limited to explicitly selected files.

## Acceptance criteria

1. A learner can identify the supported learning workflows and start one with a plain-language request or example invocation.
2. Multi-session diagnosis asks adaptive, one-at-a-time questions, offers choices and free-form input where appropriate, distinguishes preferences/self-report from demonstrated evidence, and saves each answer before continuing.
3. Roadmap approval uses the exact digest returned for the roadmap that was shown; digest mismatch cannot silently approve or advance the course.
4. The learner sees a clear roadmap with lesson objectives, durations, source references, and a readable dependency representation.
5. Schedule choices are summarized before consent, and each setup state is reported truthfully; an unsupported or unconfirmed schedule is never described as active.
6. Diagrams and questions remain in the conversation/native inline interface, with Mermaid/text fallback when inline MCP App rendering is unavailable.
7. Existing course persistence, host-specific interaction, approval, schedule receipt, and manual-dispatch contracts remain intact.

## Verification scope for the implementation plan

The plan should identify focused checks for prompt/adapter consistency, roadmap revision propagation and mismatch handling, schedule state wording and native receipt gating, and Mermaid/inline-view fallback. It should not claim a host's scheduler or inline renderer works based only on mocked tool behavior; real Codex UI acceptance must verify those capabilities explicitly.
