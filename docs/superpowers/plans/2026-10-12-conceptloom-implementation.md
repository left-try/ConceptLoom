# ConceptLoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать обучение по источникам с курсами, общей библиотекой OKF/Obsidian, памятью, интерактивной практикой и Promptfoo evals в Codex/ChatGPT и Claude Code Desktop.

**Architecture:** Существующий Node MCP остается ядром. Host adapters вызывают модель, поиск и native scheduler; общий workspace хранит знания и учебное состояние. Реализация разделена на пять планов с independently usable результатом; интеграция Tracelet и LangGraph исключена.

**Tech Stack:** Node.js >=20, ES modules, node:test; YAML и Markdown AST parsers; optional Python >=3.10/Docling; отдельный Promptfoo evaluation package на Node.js >=22.22.0.

**Spec:** [Одобренная спецификация](../specs/2026-10-12-conceptloom-learning-platform-design.md).

## Global Constraints

- Codex/ChatGPT и Claude Code Desktop поддерживаются одновременно через общие данные и отдельные host adapters.
- LangGraph и собственный agent loop отложены.
- Tracelet исключен из текущего объема: не добавляем его SDK, importer, worker или зависимости.
- Промпты организуются по OPF, знания — по официальному OKF v0.2 с учебным профилем ConceptLoom.
- Расписание включается после явного согласия учащегося с параметрами.
- Node MCP не вызывает LLM и не исполняет learner code в своем процессе. Python нужен только для подготовки документов.
- Существующие девять MCP tools и schema v1/v2 сохраняют совместимость; новые guards опциональны для legacy callers.
- Приватные criteria/attempts/profile остаются вне export vault; unknown YAML fields и пользовательский body сохраняются.
- Модули не печатают логи в stdout MCP. Tool errors имеют машинный code и текст, malformed inputs не меняют состояние.
- Promptfoo, Docling и executor устанавливаются отдельно; отсутствие этих компонентов не мешает текущему обучению.

## Review Focus

Пять рисков получили проверки в дочерних планах:

1. Windows path с пробелами/кириллицей, symlink/junction за workspace → отказ записи вне root (F1, K1/K5).
2. Два MCP процесса и падение между state/evidence writes → conflict/recovery без потери попытки (F1/F2, C4).
3. Программа платного курса выдана за прочитанную книгу → честное coverage и запрет зависимого урока (K2, C2).
4. Правки заметок и roadmap в Obsidian → сохранение body, conflict и новое approval (K1/K5, C3).
5. Недоступные native UI/scheduler/executor → видимый fallback; повторный run не дублирует урок (C4/C5, P2/P4).

## Порядок и результаты

| Этап | План | Зависит от | Проверяемый результат |
|---|---|---|---|
| 1 | [Foundation](2026-10-12-conceptloom-foundation.md) | Текущий checkout | Полнее объяснения, OPF build, надежная память, красивые semantic Mermaid, локальные event contracts |
| 2 | [Knowledge](2026-10-12-conceptloom-knowledge.md) | 1 | Импорт/поиск материалов, граф источников и заметок, переносимый OKF/Obsidian vault, optional OCR |
| 3 | [Courses](2026-10-12-conceptloom-courses.md) | 1–2 | Диагностика → research → roadmap → consent → отдельные lesson chats в обоих hosts |
| 4 | [Practice/UI](2026-10-12-conceptloom-practice.md) | 1–3 | HTML граф, сценарии/симуляции, coding labs, сохранение попыток |
| 5 | [Evaluation](2026-10-12-conceptloom-evaluation.md) | 1; полный release после 2–4 | Promptfoo regression suite, replay записанных материалов, рубрики и quality report |

Evaluation contracts и первые fixtures вводятся в этапе 1. Этап 5 расширяет их; подготовку dataset можно начать после этапа 1. Каждый этап заканчивается работающим increment и отдельными commits.

## Карта файлов и владение

- Foundation: `src/storage/`, `src/workspace.mjs`, `src/prompts/`, `prompts/`, `src/evaluation/`, `src/tool-registry.mjs`; текущие progress/checkpoints/diagrams, setup и generated references.
- Knowledge: `src/knowledge/`, `src/sources/`, `schemas/knowledge*.json`, `schemas/source*.json`, `python/conceptloom_documents/`, tools этих модулей.
- Courses: `src/courses/`, `src/hosts/`, `schemas/course*.json`, host skill guidance и scheduling recipes.
- Practice: `src/practice/`, `src/ui/`, `ui/`, `schemas/exercise*.json`, MCP resources.
- Evaluation: `evals/`, `scripts/eval-*.mjs`, `.github/workflows/evaluation.yml`; использует contracts, не переписывает grading policy.
- `src/bridge.mjs` остается transport entry point. Новые tools регистрируются в своих модулях через registry; JSON-RPC handling не копируется.

## Общие контракты между этапами

`root` в signatures — resolved learning workspace, не каталог checkout. Все async storage функции возвращают Promise. Ошибки имеют `{code,message,details?}`.

- `RevisionConflict` code `REVISION_CONFLICT`; unsafe path `OUTSIDE_WORKSPACE`; неизвестные функции host `CAPABILITY_UNAVAILABLE`.
- `CaptureEvent` schemaVersion 1: `eventId,eventType,timestamp,host,input,output`; optional `runId,parentId,courseUid,lessonUid,nodeUid,promptId,promptDigest,sourceHashes,model,tokenUsage`. Private fields проходят explicit allowlist.
- `EvalResult`: `eventId,evaluatorId,evaluatorVersion,status` (`completed|error|skipped`), optional `score,dimensions,rationale,diagnostics`.
- `SourceCoverage`: `metadata|syllabus|summary|partial|full`; это степень фактического доступа, а не автоматически проверенная достоверность.
- `HostCapabilities`: `host` (`codex|claude-code|chatgpt|other`), `questions,search,fetch,freshScheduledChat,mcpAppUi,localHtml,codingExecutor` booleans; receipts содержат фактически доступный native method, external ID и scope.
- `conceptloom/1`: stable UID, aliases, typed relations; paths по официальному OKF. Детальные schema принадлежат K1/K2/C1/P1.

## Приемка всего продукта

- [ ] **1. Foundation gate:** existing tests + новые state/OPF/diagram/event fixtures проходят на Node 20 и текущем LTS.
- [ ] **2. Knowledge gate:** vault после переноса открывается в Obsidian; агент находит источник и страницу, обходит course/lesson/concept links, сохраняет ручную заметку.
- [ ] **3. Courses gate:** реальный учебный пример в каждом host проходит research/approval/dispatch; повторный run не выпускает дубль, вопрос учащегося продолжается в lesson chat.
- [ ] **4. Practice gate:** scenario и coding attempt сохраняются с правильной revision; public UI не содержит grading criteria.
- [ ] **5. Evaluation gate:** 24 contract/workflow cases и 24 human-labeled teaching cases имеют явные результаты; critical invariants 100%, обязательные rubric dimensions >=2/3. Ошибки/пропуски не засчитываются как pass.
- [ ] **6. Release:** обновить `README.md`, `docs/ru/README.md`, `docs/architecture.md`, `CHANGELOG.md`; в release report разделить automated evidence и ручные host проверки. Не объявлять поддержку host feature до успешной проверки в нем.

## Проверенные зависимости и документация

- [YAML 2 Document API](https://eemeli.org/yaml/) — сохранение unknown fields/comments, проверка errors перед записью.
- [Markdown AST](https://github.com/syntax-tree/mdast-util-from-markdown) — links без regex по всему документу.
- [Ajv и dialects JSON Schema](https://ajv.js.org/json-schema.html) — Draft 2020-12 через соответствующий entry point.
- [Docling](https://github.com/docling-project/docling/blob/main/README.md) — Python >=3.10, local conversion/OCR.
- [Promptfoo installation](https://www.promptfoo.dev/docs/installation/) — требует Node >=22.22.0, поэтому отдельный `evals/package.json`, без повышения runtime floor MCP.

## Execution handoff

Статус: планы написаны, продуктовый код и fixtures не изменены. Рекомендуется **Native**: выполнять последовательно в этом чате, поскольку этапы разделяют contracts и изменения transport/state. По правилу writing-plans перед исполнением пользователь читает план и выбирает Native либо Subagent-driven. Реальные расписания курса и paid evals включаются только отдельным явным действием.
