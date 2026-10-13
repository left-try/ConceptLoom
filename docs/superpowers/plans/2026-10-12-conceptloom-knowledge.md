# ConceptLoom Knowledge — план реализации фазы 2

**Статус:** план; кодирование не начато. Контракт: [спецификация фазы 2](../specs/2026-10-13-conceptloom-knowledge.md). Проверки: [план тестирования](2026-10-13-conceptloom-knowledge-test-plan.md).

**Цель:** выполнить KNW-1…KNW-10: дать единый OKF/Obsidian knowledge vault, воспроизводимый source pipeline, поиск и граф, optional document conversion, conflict-safe updates и portable export.

**Подход:** SDD фиксирует контракты из спецификации; внутри каждого K-task соблюдать TDD: написать падающий тест → выполнить и проверить ожидаемую причину → минимальная реализация → целевой набор → рефакторинг → commit. K-tasks выполняются последовательно одним исполнителем; не требуется делегирование.

**Базовый стек:** Node.js >=20, ES modules, `node:test`, текущий YAML AST parser; для ссылок использовать Markdown AST parser, если проверка official docs/fixtures подтвердит необходимый GFM/footnote parsing. Python >=3.10 и Docling — optional extra для K4. Не подключать в MCP-request path автоматическую установку зависимостей.

## Порядок и зависимости

| Шаг | Задача | Зависимость | Результат |
|---|---|---|---|
| K1 | OKF parser/profile и инициализация vault | Foundation F1 | валидируемые и сохраняемые Knowledge nodes |
| K2 | импорт, receipt, assets, coverage и chunks | K1 | версии источников с проверяемыми locators |
| K3 | graph, индекс, поиск и чтение | K1, K2 | локальные read/search/traversal tools |
| K4 | optional conversion/OCR adapter | K2 | resumable page artifacts с quality status |
| K5 | конфликтобезопасное обновление и export | K1–K3; K4 optional | безопасная правка и переносимый bundle |

K4 может реализовываться после K2 независимо от K3, но общий план ведётся последовательно ради одного исполнителя и ясных контрактов. K5 не должен блокироваться отсутствующим converter или upstream backend.

## K1 — OKF parser, ConceptLoom profile и vault initialization

**Файлы:** создать `src/knowledge/format.mjs`, `src/knowledge/profile.mjs`, `schemas/knowledge-node.schema.json`, `test/knowledge-format.test.mjs`, `test/fixtures/knowledge/`; изменить `package.json`/lockfile только при необходимости parser dependency.

**Контракты:** `initializeKnowledge(root)`, `parseKnowledge(markdown,{path,bundleRoot})`, `validateKnowledge(parsed,{strictProfile})`, `serializeKnowledge(parsed,{metadataPatch,body})`. OKF ID определяется bundle-relative path без `.md`; ConceptLoom UID независим от filename. Неизвестные поля/types сохраняются, профильные поля валидируются отдельно от standard conformance.

**TDD:** сначала тесты на обязательный `type`, исключения `index.md`/`log.md`, root `okf_version`, дату log headings, неизвестные поля и типы round-trip, UID/title без переименования файла, malformed/duplicate YAML без записи, `verified` отдельно от learner mastery. RED: модуль отсутствует/контракт не соблюдается.

**Реализация:** идемпотентно и без перезаписи пользовательских документов создавать `vault/Knowledge` и `vault/Personal`; metadata править через YAML Document AST; body и comments вне изменяемых полей сохранять. Дать diagnostics уровня severity, различая OKF conformance и strict ConceptLoom readiness. Типы: Course, Lesson, Concept, Reference, Source Fragment, Exercise; неизвестный тип остаётся читаемым generic node.

**Проверка/commit:** `node --test test/knowledge-format.test.mjs`; commit `feat: support portable OKF learning notes`.

## K2 — source import, immutable assets, receipts и chunks

**Файлы:** создать `src/sources/import.mjs`, `src/sources/chunks.mjs`, `src/sources/tools.mjs`, `schemas/source-manifest.schema.json`, `schemas/research-receipt.schema.json`, `test/sources.test.mjs`, fixtures; изменить `src/tool-registry.mjs` и документацию `docs/{en,ru}/learning-with-source-materials.md`.

**Контракты:** `importSource(root,{resource,title,author,language,version,coverage,content,localFile,receipt})`, `prepareSource(root,{sourceUid,extraction})`, `chunkSource({sourceUid,contentHash,sections,maxChars})`. Source manifest versionируется, содержит access/coverage/content hashes/originalStorage/status/error. Receipt фиксирует query, реально открытый resource, fetchedAt, representation, coverage, hash/locators и limitations. Locator всегда привязан к source UID + content hash.

**TDD:** import с hash оригинала; повторный idempotent import; новая версия с сохранением старой; traversal отклонён; raw/summary/metadata/partial различаются; coverage не выдаётся за полный доступ; summary не создаёт ложные chunks; chunks сохраняют headings/pages/locators; Reference связывается с материалом и его значимыми фрагментами. RED до реализации API.

**Реализация:** писать assets под `assets/<uid>/<contentHash>/`, не изменять оригинал; лимит размера по умолчанию 250 MiB с настройкой workspace; import получает от host уже доступный текст/файл и receipt, не делает автономный fetch. Chunks — производные JSONL; Reference/Source Fragment — Markdown nodes. Добавить `loom_import_source`, `loom_prepare_source`, `loom_get_source` с backward-compatible tool registry.

**Проверка/commit:** `node --test test/sources.test.mjs`; tool catalog tests; commit `feat: import source materials with provenance and locators`.

## K3 — graph indexing, search и read tools

**Файлы:** создать `src/knowledge/links.mjs`, `src/knowledge/index.mjs`, `src/knowledge/search.mjs`, `src/knowledge/tools.mjs`, `test/knowledge-index.test.mjs`, `test/knowledge-search.test.mjs`; изменить registry/dependencies при необходимости.

**Контракты:** `indexKnowledge(root,{includePersonal:false})`, `searchKnowledge(root,{query,limit,cursor,scope})`, `getKnowledgeNode(root,{uid|path})`, `getNeighborhood(root,{uid,depth,limit})`. Traversal depth ≤3 и limit ≤200; устойчивые endpoints, occurrence provenance и source hashes. Локальный JSON inverted index, без embeddings/vector DB.

**TDD:** graph source→fragment→lesson→concept; Markdown links/definitions/footnotes; wikilinks из eligible text, но ambiguity становится diagnostic; fenced code не создаёт edges; percent-encoded path/anchor; дубли occurrences сохраняют provenance; кириллические aliases и текст глав находятся поиском; приватные assessment данные отсутствуют; изменение index revision инвалидирует cursor; циклы завершаются в пределах bound.

**Реализация:** парсить Markdown AST вместо regex по сырым code fences; строить canonical typed edges и сливать одинаковые edges без потери источников; Unicode-normalized tokenization + deterministic TF scoring; отдельно индексировать Personal только по явному настройству и scope. При изменившихся hashes reindex до ответа. Добавить `loom_search_knowledge`, `loom_read_knowledge`, `loom_knowledge_graph`.

**Проверка/commit:** целевые node:test suites; fixture из 1,000 локальных заметок для измерения elapsed time, без неподтверждённого абсолютного performance claim; commit `feat: search and traverse the learning knowledge graph`.

## K4 — optional document conversion/OCR adapter

**Файлы:** создать `src/sources/document-adapter.mjs`, `test/document-adapter.test.mjs`, `test/fixtures/documents/manifest.json`; optional Python package в `python/` и unit tests. Изменить source preparation tool/docs.

**Контракт:** Node adapter передаёт Python worker через аргументы и JSON stdin request с `schemaVersion`, source asset, output dir, `ocrMode`, languages и resume cursor. Python stdout — JSONL progress и один final result, stderr — logs. Page result содержит physical/printed page, text/blocks, content hash, `usable|needs-review|failed` и конкретные quality signals.

**TDD:** недоступный converter даёт actionable diagnostic; timeout сохраняет оригинал; retry обрабатывает только неготовые страницы; плохая страница блокируется от citation/evidence use; locator переживает повторный импорт; RU/EN born-digital/scanned, rotation, 2-column, table, formula/mixed fixture.

**Реализация:** Docling как отдельная extra/optional runtime с закреплённой tested version; не устанавливать его во время MCP-запроса. Bounded output/time; resumable page artifacts; heuristic flags — diagnostics, не оценка точности. Adapter не пишет поверх source.

**Проверка/commit:** Node adapter suite и `python -m unittest discover -s python/tests`; отдельно benchmark с установленной engine на лицензируемых/синтетических RU/EN fixtures, проверка структуры/locators/character error. Без engine отметить интеграционный gate как непроверенный и не заявлять conversion готовой. Commit `feat: prepare documents with resumable OCR provenance`.

## K5 — conflict-safe updates, export и backend boundary

**Файлы:** создать `src/knowledge/update.mjs`, `src/knowledge/export.mjs`, `src/knowledge/backend.mjs`, тесты update/export, `docs/okf-agent-knowledge-contract.md`; изменить Knowledge tool registry и README.

**Контракты:** `updateKnowledge(root,{path,expectedHash,metadataPatch,blockId,generatedBody})`; `exportKnowledge(root,{format:'okf'|'obsidian',destination,includeAssets})`. Update использует Foundation workspace lock, hash checks и transactions. Export destination ограничен workspace exports и не может пересечься с исходным vault. Backend interface локально реализуется полностью; upstream — optional capability handshake.

**TDD:** hash conflict сохраняет body; damaged/duplicate markers запрещают запись; unknown YAML сохраняется; traversal/symlink asset отклоняется; relocated vault сохраняет относительные links; OKF export исключает Personal/private data; Obsidian export включает Personal только явно; external/missing assets перечислены; unavailable backend использует явный локальный fallback.

**Реализация:** генерируемые секции имеют однозначные markers; marker mismatch диагностируется и блокирует запись. Все обновления атомарны и под F1 lock. Export строит allowlisted manifest, копирует только подтверждённые assets, проверяет links, описывает nonportable dependencies. Публикуемый upstream contract содержит schema/fixtures/examples, не меняя другой repo и не объявляя неподтверждённые upstream APIs.

**Проверка/commit:** целевые update/export tests; ручной Obsidian smoke test: открыть скопированный vault, пройти Knowledge→Reference→Fragment→Lesson и убедиться, что Personal остаётся пользовательским Markdown; commit `feat: preserve editable notes and export Obsidian knowledge`.

## Финальный gate фазы

1. Запустить все новые K1–K5 tests и проверить, что каждый KNW criterion имеет хотя бы один тест.
2. Запустить `npm run verify` и `npm run check:prompts`.
3. Выполнить `git diff --check`; проверить generated references и статус clean после commits.
4. Повторить полный gate на Node 20 и актуальном LTS; записать фактические версии и любые OS-specific skips.
5. Отдельно записать Obsidian smoke test и optional Docling benchmark. Ни ручная проверка, ни optional skip не подменяют автоматические требования безопасности, privacy и provenance.

## Допущения / блокеры

- Пользовательские материалы обрабатываются только при наличии права доступа; сетевой crawler не входит в фазу.
- Точная схема `conceptloom/1` и типизированные relation kinds фиксируются при K1 из одобренного design doc, до кода по ним добавляются conformance fixtures.
- Tool names/schema добавляются обратно совместимо с девятью инструментами Foundation.
- Актуальные версии/parser API и PDF converter API перепроверяются по официальным docs перед зависимыми K-tasks; выбранные версии фиксируются в lockfiles.
