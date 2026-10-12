# ConceptLoom Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Улучшить текущий урок без потери state: OPF prompts, надежная фиксация попыток, semantic Mermaid и локальные evaluation contracts.

**Architecture:** Выделить storage и tool registry из существующих modules; сохранить stdio entry point и legacy tools. OPF служит исходником generated references, модель продолжает работать в host.

**Tech Stack:** Node >=20, node:test, `yaml` 2, Ajv Draft 2020-12; exact installed versions фиксируются lockfile при реализации.

**Spec:** [Разделы 3, 7, 9, 10](../specs/2026-10-12-conceptloom-learning-platform-design.md); [общие constraints/contracts](2026-10-12-conceptloom-implementation.md).

## Global Constraints

- LangGraph и собственный agent loop отложены.
- Tracelet исключен из текущего объема: не добавляем его SDK, importer, worker или зависимости.
- Существующие MCP tool names и schema v1/v2 совместимы; новые callers передают expectedRevision/attemptId.
- Generated references всех четырех адаптеров строятся из одного источника; Codex/Claude имеют host-specific instructions.
- Оригинальные пользовательские данные мигрируют с backup. stdout принадлежит JSON-RPC.

## Review Focus

1. Junction вне root: F1 `rejects junction escape`, ожидается `OUTSIDE_WORKSPACE`.
2. Crash после первого rename: F1 `recovers interrupted transaction`, state/evidence согласованы.
3. Retry оценки после IO error: F2 `failed commit keeps card usable`.
4. Prompt input с role delimiter: F3 `input cannot add messages`.
5. Mermaid labels с кавычками/backticks/HTML: F4 `labels remain escaped text`.

### F1: Workspace и journaled storage

**Files:** Create `src/workspace.mjs`, `src/storage/transactions.mjs`, `src/storage/paths.mjs`, `test/storage.test.mjs`, `test/workspace.test.mjs`; Modify `src/progress.mjs`, `src/notebook.mjs`, `src/bridge.mjs`, `scripts/setup.mjs`, `test/progress.test.mjs`, `test/setup.test.mjs`.

**Interfaces:** Produces `resolveWorkspace({cwd,argv,env})->string`, `resolveContainedPath(root,relative,{create=false}={})->Promise<string>`, `commitTransaction(root,{id,checks,writes,events=[]})->Promise<{id,revisions}>`, `recoverTransactions(root)->Promise<Diagnostics[]>`. Checks `{path,expectedRevision? ,expectedHash?}`; writes `{path,value,encoding:'json'|'utf8'}` (JSON object или string соответственно). expectedHash сверяется с исходными bytes, expectedRevision — с JSON revision; отсутствие файла явно проверяется null hash/revision. Transactions serialize under workspace lock; stale lock recovery requires owner liveness check, timeout never silently steals a live lock.

- [ ] **1. Write failing tests:** `patch preserves omitted arrays`, `stale revision changes nothing`, `two processes serialize`, `recovers interrupted transaction`, `rejects junction escape`, `explicit workspace survives different cwd`, `v1/v2 migration retains evidence`. Assert preserved route, one winning revision, replayed transaction ID once; filesystem failure fixture injects after first rename. Junction test uses isolated temp directories; unsupported platform setup reports explicit skip.
- [ ] **2. Run:** `node --test test/storage.test.mjs test/workspace.test.mjs test/progress.test.mjs test/setup.test.mjs`; expect new assertions fail.
- [ ] **3. Implement:** `saveLearningState(root,input)` accepts `updateMode:patch|snapshot` (default patch), optional expectedRevision, schemaVersion 3; patch preserves all omitted fields. Snapshot validates required fields and resets only explicitly replaceable lists. Use lock + unique UUID temp files + write-ahead journal; recover on startup before tools are served. Notebook updates use contained real paths and hash guard. Add `--workspace PATH` to bridge and setup-generated MCP args for all hosts, preserve process cwd fallback for old installs.
- [ ] **4. Run:** same command and existing `npm test`; expect pass. Verify a fresh process restores migrated snapshot and backup exists. Update `package.json` check script to discover all JS entry points instead of a fixed list.
- [ ] **5. Commit:** listed source/test/setup files, message `fix: preserve learning state across conflicts and restarts`.

### F2: Checkpoint commit и полноценный evidence ledger

**Files:** Create `src/assessment-service.mjs`, `test/assessment-service.test.mjs`; Modify `src/checkpoints.mjs`, `src/progress.mjs`, `src/bridge.mjs`, `test/checkpoints.test.mjs`.

**Interfaces:** Consumes F1 transaction/path functions. Produces `evaluateCheckpoint(input)->Assessment` (validate/peek only), `consumeCheckpoint(token)->void`, `assessAndPersist(root,input)->Promise<{assessment,learningState,attemptId}>`. Existing `assessCheckpoint(input)` remains synchronous compatibility wrapper; bridge calls new service. input requires sessionId/nextStep, optional attemptId/expectedRevision; persisted receipt lives `.concept-loom/assessments/attempts/<id>.json`.

- [ ] **1. Write failing tests:** `invalid answer does not consume token`, `failed commit keeps card usable`, `same attempt returns receipt after restart`, `same attempt with different input conflicts`, `parallel same token records once`, `hinted success is not unaided retrieval`. Assert attempts=1 on replay; expected/rationale absent from public card; hinted result records assistance and does not extend unaided streak. Review interval for first unaided success=1 day, next=3 days; failure=1 day.
- [ ] **2. Run:** `node --test test/checkpoints.test.mjs test/assessment-service.test.mjs test/progress.test.mjs`; expect new cases fail.
- [ ] **3. Implement:** validate before mutation, then serialize assessment by token and transaction ID; store full attempt/hint/confidence/dimension/rubric version together with updated session snapshot and receipt. Consume only after commit. Legacy requests get generated attemptId returned to caller; reliable retries reuse it. Cards remain TTL 6h and process-local; restart creates fresh card while committed receipts remain recoverable.
- [ ] **4. Run:** command from step 2; expect pass including injected persistence error and concurrent calls.
- [ ] **5. Commit:** touched modules/tests, message `fix: commit checkpoint evidence before consuming cards`.

### F3: OPF catalog и полные структурированные объяснения

**Files:** Create `prompts/registry.yaml`, `prompts/{diagnose,research-course,plan-course,teach-lesson,practice,resume}.opf.md`, `src/prompts/loader.mjs`, `scripts/build-prompts.mjs`, `test/prompts.test.mjs`; Modify `shared/coaching-reference.md`, four `adapters/*/<host-hidden-dir>/skills/concept-coach/references/coaching-reference.md`, Codex/Claude SKILL.md, `scripts/setup.mjs`, `package.json`, `package-lock.json`.

**Interfaces:** Produces `loadPrompt(id,inputs)->Promise<{id,digest,messages}>`, `buildReferences({check=false}={})->Promise<{changedPaths}>`. Registry format `opf-registry/1`, prompt source `opf/0.2`; compatible parser follows linked official syntax/schema in initial audit. Digest is SHA-256 of source with CRLF normalized to LF. Inputs substitute into parsed message bodies, never reparsed as role structure.

- [ ] **1. Write failing tests:** `six catalog prompts load`, `missing input fails`, `input cannot add messages`, `CRLF keeps digest`, `reference drift is detected`. Assert teach-lesson contract contains goal/prerequisites/mechanism/worked-example/limitations/practice/source links; short administrative replies stay short. Compare parsing to official OPF fixtures, reject unknown non-namespaced metadata per schema.
- [ ] **2. Run:** `node --test test/prompts.test.mjs`; expect missing catalog/parser failures.
- [ ] **3. Implement:** install YAML/Ajv with lockfile, parse OPF into messages; keep static references free of unresolved runtime placeholders. Replace current instruction requiring complete state lists with patch/revision guidance from F1. Teach one connection at a time with worked example; full topic overview lives in roadmap. Add `build:prompts` and `check:prompts` scripts. Host prompts use actual question/search tools; no automatic subagent creation prerequisite.
- [ ] **4. Run:** `node scripts/build-prompts.mjs --check` and tests; expect generated copies identical, useful host distinctions retained. Setup fixture must install generated reference successfully.
- [ ] **5. Commit:** catalog, loader, generated references and setup files, message `feat: organize coaching prompts with OPF`.

### F4: Semantic Mermaid и transport registry

**Files:** Create `src/tool-registry.mjs`, `src/diagram-tools.mjs`, `test/bridge.test.mjs`; Modify `src/bridge.mjs`, `src/diagrams.mjs`, `test/diagrams.test.mjs`.

**Interfaces:** Produces `createToolRegistry(root)->{catalog,invoke}`, `renderRelationMap({nodes,edges,direction='LR',theme='neutral'})->{format,source,markdown}`. Node `{id,label,kind,status?}`, edge `{from,to,label?}`. `loom_show_relation_map` accepts legacy source or semantic nodes/edges, never both. All later tool modules export `tools(root)->Array<{definition,invoke}>`.

- [ ] **1. Write failing tests:** `semantic nodes have consistent styles`, `labels remain escaped text`, `missing endpoint fails`, `duplicate node ID fails`, `legacy source still works`, `MCP serves valid JSON only`. Assert deterministic generated IDs/classes; no raw HTML label injection, no Markdown fence escape. Tool fixture frame→assess exercises F2 through stdio.
- [ ] **2. Run:** `node --test test/diagrams.test.mjs test/bridge.test.mjs`; expect new cases fail.
- [ ] **3. Implement:** separate catalog/invocation from stdio; semantic graph uses distinct muted classes for source/course/lesson/concept, short readable labels, grouping and captions. Plain text remains fallback. Preserve protocol negotiation; never advertise resources/UI until P2 implements them.
- [ ] **4. Run:** command from step 2; expect pass and both source/semantic inputs validate.
- [ ] **5. Commit:** modules/tests, message `feat: render themed semantic learning diagrams`.

### F5: Локальные capture contracts и первые eval fixtures

**Files:** Create `schemas/capture-event.schema.json`, `schemas/eval-result.schema.json`, `src/evaluation/capture.mjs`, `test/capture.test.mjs`, `test/fixtures/contracts/`; Modify `src/assessment-service.mjs`, `src/tool-registry.mjs`.

**Interfaces:** Consumes F1 transactions; produces `captureEvent(root,event)->Promise<{recorded:boolean,diagnostics}>`, `validateContract(name,value)->{valid,errors}`. Event/Result fields в overview; schemas Draft 2020-12. Events written `.concept-loom/evaluation/events.jsonl`, serialized/deduplicated by eventId.

- [ ] **1. Write failing tests:** `duplicate event recorded once`, `private fields excluded`, `unknown usage stays absent`, `outbox failure does not undo committed assessment`, `recover capture from receipt`. Assert public capture cannot contain criteria/expected/hidden reasoning; critical schema invalidity is error.
- [ ] **2. Run:** `node --test test/capture.test.mjs`; expect missing contracts failures.
- [ ] **3. Implement:** explicit field allowlist + append lock, recoverable capture pointer in transaction receipt. Record practice-assessed/state-restored with factual tool data; accept lesson-published only through later explicit artifact tool. Build first 8 of 24 contract cases (state, cards, OPF, diagrams, capture); ledger maps IDs to originating fixtures. No external SDK/worker.
- [ ] **4. Run:** capture tests, `npm run verify`, `node scripts/build-prompts.mjs --check`; expect pass on Node 20 and LTS. Add Foundation README notes covering updated persistence semantics.
- [ ] **5. Commit:** contracts/capture/fixtures/docs, message `feat: capture local learning evaluation artifacts`.
