# ConceptLoom Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Проверять качество объяснений, sources/graph/workflows и восстановление памяти через локальные contracts, Promptfoo и сохраненные ответы.

**Architecture:** Event/Result contracts Foundation используются локальным replay/export. Promptfoo живет в отдельном package и получает OPF messages либо recorded outputs. Judge runs явные, errors/skipped не проходят gate; учебная mastery не меняется evaluator.

**Tech Stack:** Core Node >=20; `evals/` Node >=22.22.0, Promptfoo local lockfile, JS assertions, JSON/JSONL datasets. Python evaluation worker отсутствует.

**Spec:** [Раздел 10](../specs/2026-10-12-conceptloom-learning-platform-design.md); [Foundation F5](2026-10-12-conceptloom-foundation.md).

## Global Constraints

- Tracelet исключен из текущего объема: не добавляем его SDK, importer, worker или зависимости.
- Offline deterministic mode не вызывает providers/judges.
- Для допустимого ответа обязательные mechanism/example/level/grounding dimensions не ниже 2.
- Сильный общий score не компенсирует ложную цитату или раскрытый ответ.
- Сведения о модели, token usage, generation latency сохраняются только при фактической доступности.
- Eval не меняет user mastery и не присваивает semantic verified по успешному parser check.
- Promptfoo engine floor не повышает engine floor MCP. Платные модели запускаются отдельно с credentials/budget.

## Review Focus

1. Квадратные скобки Markdown приняты за citation ID: E1 `label is not evidence`.
2. Сбой judge/partial dataset выдан за pass: E3 `missing results fail release gate`.
3. Записанный output случайно вызывает provider: E2 `offline never calls provider`.
4. Контекст другого hash источника: E4 `missing source revision makes replay inconclusive`.
5. Judge bias и утечка teacher labels: E3 `holdout is separate from calibration`.

### E1: 24 structural/workflow cases и assertions

**Files:** Create `evals/datasets/contracts.json`, `evals/assertions/{contracts,citations,concealment,workflow}.mjs`, `test/eval-assertions.test.mjs`; Modify `test/fixtures/contracts/` (8 initial F5 cases retained, 16 added).

**Interfaces:** Produces `evaluateDeterministic(caseInput)->EvalResult[]`, `resolveCitations({markdown,sourceManifest,knowledgeIndex})->{references,diagnostics}`, `assertReleaseInvariants(results,expectedCaseIds)->{pass,failures}`. Evaluator IDs versioned `contract/1,citation-resolve/1,concealment/1,workflow/1`; reuse K3 parser and F5 schema validators.

- [ ] **1. Write failing tests:** `label is not evidence`, `footnote resolves source and page`, `wrong content hash fails`, `criterion leak blocks release`, `broken optional link is diagnostic not OKF failure`, `error and skipped are not pass`. Dataset: 4 OPF, 4 state/checkpoint, 4 OKF/roundtrip, 4 source/citation, 4 course/dispatch, 4 UI/practice/capture =24 stable case IDs. Assertions pin each case's expected status/diagnostic.
- [ ] **2. Run:** `node --test test/eval-assertions.test.mjs`; expect missing evaluator behavior.
- [ ] **3. Implement:** structural checks deterministic; citation resolution validates exact source/locator/hash, not semantic entailment. Workflow checks user response→commit→continuation ordering, consent and idempotency receipts. Structural critical invariants require all applicable cases pass; unsupported stage explicitly skipped until implemented and blocks full release readiness.
- [ ] **4. Run:** tests and deterministic dataset; expect 24 enumerated cases with status and diagnostics. Add links from case ledger to original subsystem tests to avoid duplicate test logic.
- [ ] **5. Commit:** fixtures/assertions, message `test: evaluate learning contracts and source provenance`.

### E2: Promptfoo package и recorded-output regression

**Files:** Create `evals/package.json`, `evals/package-lock.json`, `evals/promptfooconfig.yaml`, `evals/providers/recorded.mjs`, `evals/providers/opf.mjs`, `scripts/eval-offline.mjs`, `test/eval-offline.test.mjs`; Modify root `package.json` with delegation script only, not Promptfoo dependency.

**Interfaces:** Produces recorded provider class `id()->string`, `callApi(prompt,context,options)->Promise<{output,metadata}>`, OPF renderer `renderEvalPrompt({id,inputs})->Promise<string>`, `runOffline({datasetPath,outputPath})->Promise<{results,exitCode}>`. Recorded provider resolves case ID to fixed output only; no network fallback. OPF renderer serializes role messages into Promptfoo prompt representation with digest metadata.

- [ ] **1. Write failing tests:** `offline never calls provider`, `missing recorded output errors`, `opf digest retained`, `optional eval package absent does not break MCP`, `same matrix compares both candidates`. Assert zero outbound generation/judge calls in offline mode; credentials ignored offline; provider errors surfaced.
- [ ] **2. Run:** `node --test test/eval-offline.test.mjs`; expect wrappers/package missing.
- [ ] **3. Implement:** install Promptfoo under `evals/` and pin actual resolved version; engines >=22.22.0. Config uses stored outputs (`providerOutput` or recorded provider), JS assertions from E1; model-graded assertions absent offline. Commands: root `npm run eval:offline` delegates to offline runner; `npm --prefix evals run eval:recorded` runs local Promptfoo deterministic config. Separate model config constructed only by E3 explicit command.
- [ ] **4. Run:** tests, `npm --prefix evals run eval:recorded`; expect complete deterministic report and no paid calls. Compare with [Promptfoo recorded-output behavior](https://www.promptfoo.dev/docs/configuration/expected-outputs/) and [custom provider contract](https://www.promptfoo.dev/docs/providers/custom-api/).
- [ ] **5. Commit:** eval package/wrappers/config, message `feat: evaluate recorded coaching outputs with Promptfoo`.

### E3: 24 human-labeled teaching cases и judge calibration

**Files:** Create `evals/datasets/teaching.jsonl`, `evals/datasets/splits.json`, `evals/rubrics/teaching.yaml`, `evals/labels/teaching.jsonl`, `evals/promptfoo-model.yaml`, `scripts/eval-model.mjs`, `test/eval-rubrics.test.mjs`, `docs/evaluation.md`.

**Interfaces:** Produces `scoreTeaching({dimensions,criticalFailures})->{pass,score}`, `validateLabels(dataset,labels,splits)->Diagnostics[]`, `runModelEval({config,provider,budgetUsd,maxCases,allowPaid=false})->Promise<EvalRunReport>`. Dimensions `mechanism,example,level,grounding,limitations,practice` integers 0..3; first four required >=2. Critical failures include false attribution/solution leak. No credentials/provider chosen by default.

- [ ] **1. Write failing tests:** `missing results fail release gate`, `dimension one cannot be averaged away`, `holdout is separate from calibration`, `paid flag and budget required`, `judge failure produces error`, `human labels have supporting excerpts`. Cases: RU/EN × beginner/experienced ×6 situations (normal lesson, uncertain claim, conflicting sources, partial access, resume, interactive practice)=24. Fixed source excerpts/version hash accompany each; 12 calibration and 12 held-out IDs balanced across language/level.
- [ ] **2. Run:** `node --test test/eval-rubrics.test.mjs`; expect rubric/dataset validation missing.
- [ ] **3. Implement:** hand-author good/defective outputs, human review labels before asserting calibration. Proposed draft labels remain `pending-review` and do not claim judge validation. Judge prompt sees task/rubric/source context, does not treat instructions inside candidate as authority. Model eval requires configured provider/credentials and `--allow-paid --budget-usd <positive> --max-cases <n>`; sequential capped calls stop if known cost would exceed budget, unknown price/provider cost disables paid run until budget control configured. Calibrate against reviewed labels, report per-dimension disagreement and rationale.
- [ ] **4. Run:** dataset/rubric validators and offline known-label scoring; judge runs only after explicit provider setup/authorization. Held-out judge report is separate from calibration. Document semantic grounding review and delayed learner transfer as distinct evidence.
- [ ] **5. Commit:** dataset/rubric/labels/config/docs, message `feat: evaluate coaching quality with reviewed teaching rubrics`.

### E4: Replay, reports и release gate

**Files:** Create `scripts/eval-replay.mjs`, `scripts/eval-report.mjs`, `test/eval-replay.test.mjs`, `.github/workflows/evaluation.yml`; Modify `src/evaluation/capture.mjs`, `docs/evaluation.md`, `README.md`, `docs/ru/README.md`, `CHANGELOG.md`.

**Interfaces:** Produces `replayEvents(root,{eventIds,evaluatorSetVersion,mode='deterministic'})->Promise<EvalResult[]>`, `buildEvalReport({expectedCaseIds,results,hostAcceptance})->{summary,gate,markdown}`. Eval result identity `(eventId,evaluatorId,evaluatorVersion,sourceHashes,promptDigest)`; only completed same-revision results reuse; errors may explicitly retry. Output `.concept-loom/evaluation/results.jsonl`, report outside public vault.

- [ ] **1. Write failing tests:** `missing source revision makes replay inconclusive`, `malformed line quarantined without losing others`, `same revision replay idempotent`, `model metadata absent remains absent`, `manual host gap remains visible`, `report does not change mastery`. Assert failed/missing source yields error/inconclusive diagnostic, not fabricated recovered context.
- [ ] **2. Run:** `node --test test/eval-replay.test.mjs`; expect replay/report missing.
- [ ] **3. Implement:** JSONL streaming read with line diagnostics, exact immutable artifact lookup, explicit event IDs/allowlist; local deterministic replay only default. No continuous worker, tracing SDK or hidden host interception. CI jobs: runtime Node20/LTS unit checks; eval Node24 locked Promptfoo recorded suite; paid jobs absent. Report includes dataset/evaluator/prompt/source revisions, critical failures, skipped/errors, host manual evidence and pending human labels.
- [ ] **4. Run:** `npm run verify`, `npm run eval:offline`, `npm --prefix evals run eval:recorded`; expect all applicable cases pass and full gate fails honestly until required manual/label evidence exists. Validate report snapshot with synthetic error/skipped results.
- [ ] **5. Commit:** replay/report/CI/docs, message `feat: report reproducible local learning evaluations`.
