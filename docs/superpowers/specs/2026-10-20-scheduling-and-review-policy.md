# Scheduling, Pause and Review Policy — Specification

**Status:** Draft for user review
**Scope:** User-consented reminders and evidence-driven review selection.
**Related:** [Courses phase](2026-10-13-conceptloom-courses.md), [platform design](2026-10-12-conceptloom-learning-platform-design.md), [coaching reference](../../../shared/coaching-reference.md).

## Goal

Make scheduling help learners return to the course without advancing past unfinished work, duplicating timers, or confusing reminders with evidence of learning.

## Behavior and boundaries

1. Schedule draft includes host, IANA timezone, cadence/local time, missed-run behavior and progression policy. Activation requires separate consent tied to the exact draft and a matching native receipt.
2. At a run, select in order: continue an unfinished lesson; otherwise offer a small set of due reviews; otherwise dispatch the next eligible lesson. The learner may choose a different available action.
3. A missed run never marks work complete, skips a lesson or creates a burst of catch-up lessons. Paused/completed courses are no-op.
4. Review dates use persisted assessment evidence. Unaided successful retrieval may lengthen intervals; failure or hint-dependent success does not count as unaided retrieval. Initial interval values remain the existing approved policy (1 day after first unaided success, then 3/7/14/30 days for successive successful retrievals; failure schedules a near-term retry).
5. One active schedule binding per course UID. Changing cadence, timezone, host or progression policy requires new consent. Pause/resume preserves course progression and does not silently recreate a timer.
6. Scheduling is a host-native action; the core does not claim a timer is active without a verifiable receipt.

## Acceptance criteria

- **SR-1 Explicit consent:** No schedule activates from a draft alone; modified drafts require renewed consent.
- **SR-2 Accurate receipt:** Binding records the actual host method, external ID/scope and consented schedule digest; unsupported hosts give setup instructions.
- **SR-3 One binding:** Repeated or concurrent activation cannot create multiple active schedules for one course.
- **SR-4 Safe progression:** Unfinished lesson wins over new lesson; missed runs do not skip; due reviews are bounded and do not block learner-initiated course changes.
- **SR-5 Evidence policy:** Hint use, confidence, attempt type and assessment outcome affect review eligibility as specified; model-generated feedback alone is not unaided retrieval.
- **SR-6 Pause/resume:** Pause disables active scheduling through a verified host operation where supported; resume requires valid course state and explicit schedule reactivation if the binding cannot be verified.
- **SR-7 Time correctness:** IANA timezone, daylight-saving transitions, cadence and local time are validated; displayed next-run times match the host receipt or are labeled approximate.

## Test plan

- Unit tests for schedule draft validation, digest-bound consent, review interval transitions, due ordering and lifecycle no-ops.
- Idempotency/concurrency tests for two simultaneous bind calls and retries after timeout; verify one binding and no blind external retry.
- Time fixtures for DST gap/overlap, invalid timezone, missed run, paused course, and schedule change after consent.
- Evidence matrix: unaided success, success with hint, failure, uncertain/model-only assessment, transfer success and repeated success; assert due date and mastery fields separately.
- Host acceptance tests in each supported app verify receipt, new scheduled session, pause behavior and durable workspace. Unavailable host capabilities are recorded as unverified, not passed.

## Out of scope

An internal cron service, background agent, calendar synchronization, push notification service, or autonomous lesson completion.
