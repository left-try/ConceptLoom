# ConceptLoom Practice and UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать учащемуся интерактивный граф, сценарии, симуляции и coding labs с сохранением реальных попыток.

**Architecture:** Exercise data общие для HTML и text; criteria private. MCP Apps UI подключается по capability, local HTML экспортирует ответы для host bridge. Coding execution вынесен в optional isolated backend.

**Tech Stack:** Node >=20, vanilla HTML/CSS/JS/SVG, optional MCP Apps browser SDK bundle, optional Docker executor; no React application rewrite.

**Spec:** [Разделы 3, 9, 10](../specs/2026-10-12-conceptloom-learning-platform-design.md); [Courses](2026-10-12-conceptloom-courses.md).

## Global Constraints

- Public exercise и private grading отделены. Browser state не заменяет evidence.
- HTML без серверного grading может быть self-check, но не обещает спрятанных ответов.
- Tracelet исключен из текущего объема: не добавляем его SDK, importer, worker или зависимости.
- Capability support определяется фактически доступными tools и protocol negotiation.
- Coding execution — отдельный adapter с лимитами и изоляцией; ordinary MCP process не исполняет произвольный Python/shell.
- Private grading не попадает в resource, local HTML, vault export или UI model context.

## Review Focus

1. Double submit/late submission: P1/P3 `same attempt records once`, `wrong exercise revision rejected`.
2. Source label с HTML/script: P2 `untrusted labels render as text`.
3. UI tools unavailable: P2/P3 `local export can resume through host`.
4. Random simulation: P3 `seed replays identical scenario`.
5. Docker missing/network/file access/timeout: P4 `executor unavailable is not pass`, `limits enforced`.

### P1: Exercise contracts и assessment service

**Files:** Create `src/practice/model.mjs`, `src/practice/assessment.mjs`, `src/practice/tools.mjs`, `schemas/exercise.schema.json`, `schemas/exercise-attempt.schema.json`, `test/practice.test.mjs`; Modify `src/tool-registry.mjs`, `prompts/practice.opf.md`.

**Interfaces:** Produces `createExercise(root,{uid,lessonUid,kind,publicSpec,privateCriteria})->Promise<PublicExercise>`, `getExercise(root,{uid})->Promise<PublicExercise>`, `submitPractice(root,{attemptId,exerciseUid,exerciseRevision,response,artifacts=[],hintUsed=false,confidence?})->Promise<AttemptReceipt>`, `assessPractice(root,{attemptId,rubricVersion,verdict,criterionResults,nextStep})->Promise<AttemptReceipt>`. Kind `scenario|simulation|coding`; receipt status `submitted|assessed|execution-unverified`. Actor collecting response cannot set mastery through submit alone.

- [ ] **1. Write failing tests:** `public exercise omits criteria`, `same attempt records once`, `changed input with reused ID conflicts`, `wrong exercise revision rejected`, `grading evidence cites actual response`, `state saved before feedback`. Assert exact attempt content/hash persisted outside vault and connected to lesson/version; private criteria readable only by assessment path.
- [ ] **2. Run:** `node --test test/practice.test.mjs`; expect practice model missing.
- [ ] **3. Implement:** transaction-backed exercise/public note and private rubric; submit then assessment (deterministic scenario checker or host evaluates open response). Persist criterion results/hints/confidence and nextStep; update learning evidence via F2 policy instead of inventing second mastery system. Register `loom_create_exercise`, `loom_get_exercise`, `loom_submit_practice`, `loom_assess_practice`.
- [ ] **4. Run:** tests and public artifact byte scan for unique private marker; expect no leak, retries return receipt.
- [ ] **5. Commit:** practice schemas/services/tools/prompt, message `feat: persist interactive exercise attempts`.

### P2: HTML knowledge/lesson view и MCP resources

**Files:** Create `ui/learning-view/{index.html,app.mjs,styles.css}`, `src/ui/{resources,views,tools}.mjs`, `scripts/build-ui.mjs`, `test/ui-resources.test.mjs`, `test/ui-data.test.mjs`; Modify `src/bridge.mjs`, `src/tool-registry.mjs`, `package.json`, `package-lock.json`, `docs/host-acceptance.md`.

**Interfaces:** Consumes K3 graph, P1 public exercises and C5 capabilities. Produces `buildLearningView(root,{courseUid?,lessonUid?,focusUid?,capabilities})->Promise<{viewData,textFallback,resourceUri?,htmlPath?}>`, `listUiResources()->Resource[]`, `readUiResource(uri)->{contents}`. `viewData` includes public graph/lesson/exercise data, never private rubric. URI `ui://conceptloom/learning-view.html`, MCP resource MIME and metadata follow pinned supported MCP Apps extension.

- [ ] **1. Write failing tests:** `untrusted labels render as text`, `private criteria absent from HTML`, `resources return self-contained bundle`, `unknown resource is error`, `UI failure leaves text fallback`, `graph neighborhood bounded`. Assert `_meta.ui.resourceUri` matches registered resource; external script/network origins not required.
- [ ] **2. Run:** `node --test test/ui-resources.test.mjs test/ui-data.test.mjs`; expect resources/view module missing.
- [ ] **3. Implement:** semantic tokens for light/dark, visible source/course/lesson colors with text labels, keyboard navigation and list alternative. SVG graph limited to selected neighborhood; click shows note/source locator and requests deeper neighborhood. Use textContent for note labels; no arbitrary source HTML execution. Add resources/list/read to bridge and truthful resources capability. Use official App SDK or extension protocol browser bundle; tools/list metadata points to UI. Register `loom_open_learning_view`. Local HTML contains same public data and instructions for response export, not automatic file/network access.
- [ ] **4. Run:** tests, UI build; manually inspect narrow/wide layout, keyboard, dark mode and sample large graph. Check render in each actual host; unsupported host uses local HTML and Mermaid/text. Record matrix separately for Claude Desktop versus Claude Code Desktop; support in one is not proof for the other.
- [ ] **5. Commit:** UI/resources/build/docs, message `feat: present interactive learning views with graceful fallback`.

Reference: [MCP Apps resource/metadata/protocol](https://modelcontextprotocol.io/extensions/apps/overview). Native iframe support remains a host acceptance check, not a blanket compatibility claim.

### P3: Scenario и simulation templates

**Files:** Create `src/practice/scenarios.mjs`, `ui/learning-view/scenarios.mjs`, `examples/exercises/{debugging-scenario,isolation-simulation}.json`, `test/scenarios.test.mjs`; Modify `src/practice/tools.mjs`, `ui/learning-view/app.mjs`.

**Interfaces:** Produces `createScenarioState(publicSpec,{seed})->ScenarioState`, `applyScenarioAction(state,action)->ScenarioState`, `exportScenarioAttempt(state)->{exerciseUid,exerciseRevision,response,actions,seed}`. PublicSpec declares allowed actions, visible events and task; hidden scoring/solutions remain P1 privateCriteria. Deterministic state machine, seeded pseudorandom generator stored with attempt.

- [ ] **1. Write failing tests:** `seed replays identical scenario`, `invalid transition rejected`, `same final choice with different reasoning preserves trace`, `local export can resume through host`, `solutions appear only after assessment`. Assert scenario trace identifies decisions/order, simulation predicts outcomes; public spec lacks success keys/private rationale.
- [ ] **2. Run:** `node --test test/scenarios.test.mjs`; expect templates missing.
- [ ] **3. Implement:** two ready-to-use templates: diagnose failing tool pipeline from logs; vary transaction interleaving and predict invariant outcome. UI controls collect prediction before reveal; import/export attempt JSON passes P1 schema, host calls submit/assess. MCP Apps submits through host-proxied tools; local HTML downloads attempt file for explicit import. Add lesson prompt guidance for choosing scenario/simulation based on objective, not generating every format for every lesson.
- [ ] **4. Run:** tests and manual same exercise in MCP view/local HTML/text; assert equal grading input and preserved continuation.
- [ ] **5. Commit:** templates/UI/fixtures, message `feat: teach through scenarios and simulations`.

### P4: Optional coding labs executor

**Files:** Create `src/practice/executors/{interface,docker}.mjs`, `src/practice/coding.mjs`, `test/coding-executor.test.mjs`, `examples/exercises/python-data-transform/`, `docs/coding-labs.md`; Modify `src/practice/tools.mjs`, `src/hosts/capabilities.mjs`.

**Interfaces:** Produces `runCodingAttempt(root,{attemptId,exerciseUid,exerciseRevision,files,executorConfig})->Promise<{status,stdout,stderr,checks,durationMs,diagnostics}>`. Backend `{available(),run({stagingPath,imageDigest,command,limits})}`; command from trusted exercise runner, never learner shell text. Status `completed|failed|timeout|unavailable`; unavailable is execution-unverified, not successful.

- [ ] **1. Write failing tests:** `executor unavailable is not pass`, `limits enforced`, `learner filename escape rejected`, `private tests absent from starter export`, `stdout limit reports truncation`, `failed code preserves attempt`. Mock spawn asserts no shell, no network, readonly mounts, nonroot UID, CPU=1, memory=128MiB, pids=64, timeout=10s, output cap=64KiB.
- [ ] **2. Run:** `node --test test/coding-executor.test.mjs`; expect executor missing.
- [ ] **3. Implement:** stage only approved exercise files in contained directory; Docker backend disabled until user-configured immutable image digest. No auto pull/install in tool call. Container `--network none`, cap-drop ALL, no-new-privileges, readonly root/starter mount, tmpfs scratch. Private expected outputs/criteria remain in trusted grading harness outside learner container; harness sends only execution inputs and compares captured outputs. No private rubric/test files mounted beside learner code. Kill on timeout, persist actual results through P1; unavailable Docker falls back to analyzing submitted code with explicit unverified execution status.
- [ ] **4. Run:** mocks; optional Docker integration smoke for sample transformation lab after backend setup, prove network/host filesystem unavailable and timeout enforced. Judge-assessed reasoning and executed tests are recorded as different evidence.
- [ ] **5. Commit:** executor/lab/docs, message `feat: run coding practice through an isolated optional executor`.
