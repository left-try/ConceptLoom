# ConceptLoom Courses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Пройти от большой темы и диагностики до researched roadmap и новых lesson chats по согласованному расписанию в обоих hosts.

**Architecture:** Private versioned course state управляет progression, Markdown показывает roadmap и links. Host выполняет поиск и native scheduling; core проверяет research/consent/leases и формирует resume capsule.

**Tech Stack:** Node >=20, Foundation storage/OPF/capture, Knowledge manifests/graph, host-native tools.

**Spec:** [Разделы 2, 6–8](../specs/2026-10-12-conceptloom-learning-platform-design.md); [общие contracts](2026-10-12-conceptloom-implementation.md).

## Global Constraints

- Codex/ChatGPT и Claude Code Desktop поддерживаются одновременно через общие данные и отдельные host adapters.
- Расписание включается после явного согласия учащегося с параметрами.
- LangGraph и собственный agent loop отложены.
- Tracelet исключен из текущего объема: не добавляем его SDK, importer, worker или зависимости.
- Только один scheduler binding активен на course UID, даже если оба host adapters установлены.
- Каждый урок остается полноценным чатом с Q&A; scheduled run не засчитывает обучение за пользователя.
- Host capability определяется доступными native tools; cloud без доступа к durable workspace не объявляется готовым к продолжению курса.

## Review Focus

1. Самооценка уровня выдана за mastery: C1 `self report is not demonstrated evidence`.
2. Receipt без прочитанного материала: C2 `metadata cannot approve grounded lesson`.
3. Revision roadmap изменена после consent: C3 `old approval cannot activate revision`.
4. Retry/crash/external chat creation: C4/C5 `ambiguous publish does not retry blindly`.
5. DST, закрытое приложение, unsupported host: C5 `native timezone is explicit`, `missed run does not skip lesson`.

### C1: Course state и диагностический профиль

**Files:** Create `src/courses/model.mjs`, `src/courses/tools.mjs`, `schemas/course.schema.json`, `schemas/learner-profile.schema.json`, `test/courses.test.mjs`; Modify `src/tool-registry.mjs`, `prompts/diagnose.opf.md`.

**Interfaces:** Produces `createCourse(root,{uid,topic,goal,level?,preferences?})->Promise<Course>`, `patchCourse(root,{uid,expectedRevision,patch})->Promise<Course>`, `getCourse(root,{uid})->Promise<Course>`, `updateLearnerProfile(root,{expectedRevision,observations})->Promise<Profile>`. Course `{schemaVersion:1,uid,revision,status,topic,goal,diagnostic,roadmapRevision,lessons,sourceUids,approvals,scheduleBinding?,progression}`. Status enum from spec. Lesson `{uid,title,objectives:[],conceptUids:[],prerequisiteLessonUids:[],sourceBindings:[],exerciseUids:[],estimatedMinutes,status}`; status `pending|awaiting-learner|completed|blocked`. Observation `{field,value,basis:'self-report'|'assessment'|'preference',recordedAt,sourceAttemptId?}`.

- [ ] **1. Write failing tests:** `course survives process restart`, `self report is not demonstrated evidence`, `profile patch retains prior goals`, `preferences are not graded`, `course updates require matching revision`, `generic patch cannot bypass approval`. Assert goal/level/language/time budget saved with basis; diagnostic questions distinguish knowledge checks from preferences. Direct patch of approvals/binding/mastery/active status is rejected.
- [ ] **2. Run:** `node --test test/courses.test.mjs`; expect missing state model.
- [ ] **3. Implement:** versioned private JSON under spec paths using F1; generic patch accepts diagnostic/goal/preferences draft edits only, lifecycle/roadmap/progression/approvals owned by corresponding validated domain services. Diagnose prompt asks goal, prior experience, applied task, time and learning preferences, then targeted frontier checkpoints. Save each answer before asking next. Register `loom_create_course`, `loom_get_course`, `loom_update_course`, `loom_update_profile`.
- [ ] **4. Run:** tests + bridge catalog; expect two courses share profile but retain distinct progression.
- [ ] **5. Commit:** model/tools/prompt, message `feat: create courses from learner diagnostics`.

### C2: Mandatory research и draft roadmap

**Files:** Create `src/courses/research.mjs`, `src/courses/roadmap.mjs`, `test/course-research.test.mjs`, `test/roadmap.test.mjs`; Modify `src/courses/tools.mjs`, `prompts/research-course.opf.md`, `prompts/plan-course.opf.md`, both primary host skills.

**Interfaces:** Consumes `importSource/getKnowledgeNode`, source manifests and research receipt schema. Produces `recordCourseResearch(root,{courseUid,expectedRevision,receipts,sourceUids})->Promise<Course>`, `proposeRoadmap(root,{courseUid,expectedRevision,lessons,adaptedFrom=[]})->Promise<{course,readiness}>`, `checkRoadmapReadiness(root,course)->Promise<{ready,blockers,diagnostics}>`. Binding `{sourceUid,contentHash,locator,role:'syllabus'|'teaching'|'example',coverage}`.

- [ ] **1. Write failing tests:** `metadata cannot approve grounded lesson`, `syllabus only informs outline`, `prerequisite cycle blocks approval`, `missing source hash blocks lesson`, `external syllabus attribution retained`, `uncertain conflicting sources disclosed`. Assert receipt resource/hash matches imported manifest; every taught concept has applicable teaching material or explicit blocker.
- [ ] **2. Run:** `node --test test/course-research.test.mjs test/roadmap.test.mjs`; expect new validators missing.
- [ ] **3. Implement:** host must search then open primary documentation/books/articles/institutional programs and import available content. Request diverse formats where relevant, record unavailable course contents honestly; paid/full originals optional. Roadmap generated from learner frontier, not copied wholesale from syllabus. Create Course/Lesson/Concept links with uses-source/informed-by/supported-by scope. Missing material leaves researching/draft, not active. Register `loom_record_course_research`, `loom_propose_roadmap`.
- [ ] **4. Run:** tests with fixed official-doc/syllabus mock fixtures; expect roadmap readiness reflects actual access. Build a manual LangChain research recipe for later host UAT, without fetching a real course as part of unit tests.
- [ ] **5. Commit:** research/roadmap/tools/prompts, message `feat: build source-grounded personalized roadmaps`.

### C3: Approvals, projection edits и schedule draft

**Files:** Create `src/courses/approval.mjs`, `src/courses/projections.mjs`, `src/courses/schedule.mjs`, `schemas/schedule.schema.json`, `test/course-approval.test.mjs`; Modify `src/courses/tools.mjs`.

**Interfaces:** Produces `approveRoadmap(root,{courseUid,roadmapRevision,consent})->Promise<Course>`, `proposeCourseEdit(root,{courseUid,projectionHash,proposal})->Promise<Course>`, `setCoursePaused(root,{courseUid,paused,expectedRevision,reason})->Promise<Course>`, `draftSchedule(root,{courseUid,host,timezone,cadence,localTime,missedRunPolicy='resume-next',progressionPolicy='wait-for-learner'})->Promise<ScheduleDraft>`, `approveSchedule(root,{courseUid,draftId,consent})->Promise<ScheduleApproval>`. Consent `{recordedAt,host,userResponse,shownDigest}` tied to exact displayed content. Cadence structured `{kind:'daily'|'weekly',weekdays?:[1..7],interval:1}`; HH:mm localTime, IANA timezone checked with Intl. Native tool performs calendar scheduling; no core cron engine.

- [ ] **1. Write failing tests:** `old approval cannot activate revision`, `draft does not enable timer`, `projection edit retains manual body`, `invalid timezone rejected`, `changed cadence needs consent`, `schedule approval cannot substitute roadmap approval`. Assert lifecycle transition only with exact roadmap digest; copied consent does not authorize altered schedule.
- [ ] **2. Run:** `node --test test/course-approval.test.mjs`; expect missing consent model.
- [ ] **3. Implement:** show compact plan and time budget, persist explicit learner reply; changed objective/order/extent invalidates approval for changed revision. Pause/resume preserves progression; resume checks current readiness and approvals and does not recreate native timer silently. Update Knowledge generated blocks with expected hash; imported Obsidian edit is proposal, conflict stops projection update. Register `loom_approve_roadmap`, `loom_propose_course_edit`, `loom_set_course_paused`, `loom_draft_schedule`, `loom_approve_schedule`.
- [ ] **4. Run:** tests and restart fixture; approved draft survives restart, but no native scheduler action exists until C5 binds receipt.
- [ ] **5. Commit:** approvals/projections/schedule, message `feat: require course and schedule consent`.

### C4: Manual lesson dispatch, leases и resume capsules

**Files:** Create `src/courses/dispatch.mjs`, `src/courses/capsule.mjs`, `test/course-dispatch.test.mjs`; Modify `src/courses/tools.mjs`, `prompts/teach-lesson.opf.md`, `prompts/resume.opf.md`.

**Interfaces:** Produces `claimLesson(root,{courseUid,runId,host,now})->Promise<{status,lease?,capsule?}>`, `publishLesson(root,{leaseId,runId,artifact,hostChatId?})->Promise<DispatchReceipt>`, `completeLesson(root,{courseUid,lessonUid,expectedRevision,evidenceAttemptIds})->Promise<Course>`. Lease expires in 15 minutes; status `claimed|awaiting-learner|completed|blocked|no-op|publication-unknown`. Idempotency key `(courseUid,lessonUid,roadmapRevision)`; existing committed publication with same lesson UID also prevents unintended reissue after roadmap edits. Capsule `{courseUid,lessonUid,roadmapRevision,goal,learnerContext,sourceBindings,nextStep,dueReviews,knowledgePaths,promptDigest}`.

- [ ] **1. Write failing tests:** `two hosts claim one lesson`, `retry returns committed publication`, `lease expiration recovers unpublished run`, `unfinished lesson waits`, `course completed returns no-op`, `paused course cannot claim lesson`, `ambiguous publish does not retry blindly`, `question resumes current lesson`. Assert fixed runId replay does not change evidence/progression; no completed lesson without submitted attempts/policy.
- [ ] **2. Run:** `node --test test/course-dispatch.test.mjs`; expect leases/capsule missing.
- [ ] **3. Implement:** transaction locks for claims/publish. Store publication intent before external action; host reports actual chat ID/result. On unknown external result return needs-reconciliation, do not assume success or recreate chat. Published lesson waits for learner; Q&A updates same state. Capsule budget 16,000 characters by default: include current step/goal/IDs first, at most 5 due reviews and selected source snippets; overflow returns links/diagnostics instead of dumping full book or silently cutting instructions. Register `loom_claim_lesson`, `loom_publish_lesson`, `loom_complete_lesson`; capture factual lesson artifact with prompt/source hashes.
- [ ] **4. Run:** tests with injected crash before/after publication receipt; expect no silent loss/duplicate. Manual dispatch works without any scheduler installed.
- [ ] **5. Commit:** dispatch/capsules/prompts, message `feat: dispatch lessons with resumable course context`.

### C5: Host scheduling integrations и cross-host acceptance

**Files:** Create `src/hosts/capabilities.mjs`, `src/hosts/scheduling.mjs`, `shared/hosts/{codex,claude-code,chatgpt}-scheduling.md`, `test/host-scheduling.test.mjs`, `docs/host-acceptance.md`; Modify `src/courses/tools.mjs`, both primary host skills, `scripts/setup.mjs`, `docs/en/learning-from-scratch.md`, `docs/ru/learning-from-scratch.md`.

**Interfaces:** Produces `validateCapabilities(report)->HostCapabilities`, `prepareNativeSchedule(root,{courseUid,approvalId,capabilities})->Promise<{action,lessonLaunchPrompt}>`, `bindNativeSchedule(root,{courseUid,approvalId,receipt})->Promise<Course>`, `reconcileNativePublication(root,{runId,hostChatId,outcome})->Promise<DispatchReceipt>`. Receipt `{host,nativeMethod,externalScheduleId,executionScope,timezone,startsFreshChat,workspaceRoot,createdAt}`. Capability and receipt are actual host results, not guessed universal API.

- [ ] **1. Write failing tests:** `second active scheduler rejected`, `native timezone is explicit`, `missed run does not skip lesson`, `unsupported host gives setup instructions`, `cloud without shared storage stays unavailable`, `schedule replay reuses binding`, `unconfirmed native creation is not active`.
- [ ] **2. Run:** `node --test test/host-scheduling.test.mjs`; expect adapters missing.
- [ ] **3. Implement:** recipes invoke only actual exposed native tools; choose new-chat scheduled job instead of same-chat heartbeat for this learning flow. Persist prepared intent and receipt, stable workspace root and course UID in launch prompt. If host lacks tools, return complete user setup recipe/draft; don't claim timer enabled. Register `loom_prepare_native_schedule`, `loom_bind_native_schedule`, `loom_reconcile_dispatch`; pause/completed state returns no-op even if host timer cannot be disabled programmatically.
- [ ] **4. Run:** mock host tests, then manual real-host UAT separately for Codex and Claude Code Desktop: approve small 2-lesson course, enable consented task, confirm fresh chat, answer/question, resume, duplicate run and missed run. ChatGPT variant additionally proves durable storage access. Record actual tools/version/session IDs in acceptance doc; real tasks require user consent, disable after UAT.
- [ ] **5. Commit:** adapters/skills/docs, message `feat: schedule new lesson chats through native hosts`.
