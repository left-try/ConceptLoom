# Course, Lesson and Chat Continuity — Specification

**Status:** Draft for user review
**Scope:** Durable course progression and resumption across separate host chats.
**Related:** [Courses phase](2026-10-13-conceptloom-courses.md), [platform design](2026-10-12-conceptloom-learning-platform-design.md), [courses plan](../plans/2026-10-12-conceptloom-courses.md).

## Goal

Treat chats as replaceable lesson sessions while preserving the course, learner evidence, current lesson and next action in durable course state.

## Behavior and boundaries

- A course owns an ordered, revisioned roadmap; a lesson owns objectives, sources, exercises and status; a host chat is a session that may teach or continue one lesson.
- Stable course and lesson UIDs, not chat history, are the identity for progression. Host chat/session IDs are receipts and optional navigation metadata.
- A new lesson may start in a fresh chat. A learner may continue Q&A and practice for that lesson in its existing chat or a resumed chat.
- A resume capsule carries the learner's goal, approved roadmap revision, current lesson and step, relevant profile/evidence, source hashes/locators, due reviews and next action. It is bounded and can point to durable records rather than copy the full course.
- Publishing a lesson changes it to awaiting-learner; publication alone is not completion. Completion requires eligible attempt/evidence IDs and valid course transitions.
- Replays, concurrent dispatches and uncertain host publication outcomes must not silently publish duplicate lessons or skip work.

## Acceptance criteria

- **CC-1 Stable identity:** Separate chats resolve the same course/lesson by UID and show the correct approved roadmap revision.
- **CC-2 Cross-chat recovery:** After process restart and in a different chat, Loom restores the current lesson, learner context and exact next action without requiring the previous transcript.
- **CC-3 Lesson Q&A:** Questions during an open lesson retain the current lesson and do not advance the roadmap.
- **CC-4 Completion evidence:** Dispatch and time passage cannot mark a lesson complete; only allowed assessment attempts can do so.
- **CC-5 Idempotent dispatch:** Replay or concurrent requests for one lesson revision return the existing receipt or a conflict; they do not publish a second lesson.
- **CC-6 Uncertain external action:** Unknown publication result enters reconciliation and is not blindly retried.
- **CC-7 Portable fallback:** If the host cannot create a fresh chat or expose a chat ID, manual dispatch/resume remains usable and reports the limitation honestly.

## Test plan

- Unit tests for stable UIDs, lifecycle transitions, resume capsule contents/size, incomplete lesson status and evidence-gated completion.
- Restart integration test: create course → publish lesson → close server → resume from a different chat/session → continue same lesson and step.
- Concurrency/fault tests: two adapters claim the same next lesson, crash before receipt, crash after host action but before local receipt, stale roadmap revision and duplicate attempt IDs.
- Host contract fixtures verify that supported hosts store their actual chat/session receipt; unsupported capabilities return a manual fallback rather than a false success.
- End-to-end acceptance walkthrough follows two lessons, leaves the first unfinished, resumes it in a new chat, completes its practice, then dispatches the next eligible lesson.

## Out of scope

Host transcript import, global search across chat histories and automatic chat creation where a host has no such capability.
