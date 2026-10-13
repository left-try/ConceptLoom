# ConceptLoom Knowledge — план тестирования фазы 2

Связанные контракты: [спецификация фазы 2](../specs/2026-10-13-conceptloom-knowledge.md), [план реализации K1–K5](2026-10-12-conceptloom-knowledge.md). Документ определяет будущие тестовые доказательства; сами тесты пока не добавлялись.

## Метод SDD/TDD

Для каждого K-task до реализации выбрать одну проверяемую обязанность из KNW, добавить минимальный автоматизированный тест и запустить его. Зафиксировать RED: тест падает из-за отсутствующей функции/инварианта, а не из-за сломанной фикстуры или среды. Внести минимальную реализацию, получить GREEN, затем выполнить весь тестовый файл и соседние контракты. Рефакторинг допускается после GREEN. В конце K-task — commit и обновление progress.

Все фикстуры локальные, детерминированные и не требуют сети, модели, аккаунта, платного API или установленного OCR движка. Файлы с copyrighted material не хранить: использовать синтетические документы/данные с проверочными expected values. Ошибки безопасности, приватности, provenance и целостности — P0; их нельзя пропускать или трактовать как PASS. Optional engine absence — `not run`/integration gap, не pass.

## Матрица тестовых доказательств

| Требования | Проверки | Тип / приоритет | Основная команда |
|---|---|---|---|
| KNW-1 OKF parser/profile | required `type`; reserved root/nested `index.md` и `log.md`; даты `YYYY-MM-DD`; OKF v0.2; unknown keys/types and body round-trip; duplicate/malformed YAML no-write; UID/title edit doesn't rename; verified independent from mastery | unit + property fixtures / P0 | `node --test test/knowledge-format.test.mjs` |
| KNW-2 vault separation | initializer creates `Knowledge` + `Personal`, repeat is idempotent; pre-existing notes remain byte-identical; Personal excluded from standard validation/index by default; explicit Personal-to-OKF conversion preserves body and adds required metadata | integration / P0 | `node --test test/knowledge-format.test.mjs test/knowledge-index.test.mjs` |
| KNW-3 provenance/versioning | content hash matches immutable asset bytes; repeat import returns same identity; changed version retains prior version/locators; resource/receipt/coverage round-trip; path traversal and outside-workspace symlink rejected | integration / P0 | `node --test test/sources.test.mjs` |
| KNW-4 truthful access | metadata-only, summary, partial, extracted and raw/full content are distinct; syllabus does not imply full source access; unknown coverage remains unknown; summary does not yield source-level chunks/citations | unit + contract / P0 | `node --test test/sources.test.mjs` |
| KNW-5 chunks and locators | chapter/page boundaries retained; long paragraphs split deterministically; every chunk points to source UID/hash and a locator; source bytes unchanged; failed/empty extraction visible and not served as usable evidence | unit + integration / P0 | `node --test test/sources.test.mjs` |
| KNW-6 optional conversion | missing worker actionable; JSONL protocol/timeout/output bounds; resume only failed pages; per-page hash/locator stable; quality flags for empty/replacement-char/order loss; failed/needs-review page blocked from verified citation; originals unchanged | adapter mock / P0; OCR benchmark / P1 | `node --test test/document-adapter.test.mjs`; `python -m unittest discover -s python/tests` |
| KNW-7 graph and search | source→fragment→lesson→concept; relative links and typed relations resolve; ambiguous wikilink diagnostic; fences ignored; encoded paths/anchors; duplicate occurrence provenance; Cyrillic aliases/chapter text; private records absent; cursor invalidated on revision change; cycles/depth/count bounded | unit + integration / P0 | `node --test test/knowledge-index.test.mjs test/knowledge-search.test.mjs` |
| KNW-8 safe update | expected hash mismatch no writes; duplicate/broken markers no writes; unknown YAML and user body survive; transaction recovery; concurrent edits serialize under Foundation lock | integration / P0 | `node --test test/knowledge-update.test.mjs` |
| KNW-9 export | OKF allowlist excludes Personal/private assessment/events; Obsidian includes Personal only on explicit opt-in; relative links/assets work after relocating export; traversal/symlink escape rejected; absent external assets listed; source and destination cannot overlap | integration / P0 | `node --test test/knowledge-export.test.mjs` |
| KNW-10 optional boundary | local tools work with backend absent/disabled; no Tracelet imports/dependencies; evaluation tools remain optional; new registry tools preserve Foundation names and JSON-RPC contract | integration/regression / P0 | `node --test test/bridge.test.mjs test/assessment-service.test.mjs` |

## Набор фикстур

- **Knowledge bundle:** корректные и некорректные OKF nodes; root/nested index; date-headed log; unknown metadata; duplicate YAML keys; malformed YAML; unresolved and cross-bundle links.
- **Graph:** 3–8 узлов разных типов с обычными Markdown links, typed relations, aliases, wikilinks, anchors, процитированным кодом и одинаковыми basename для проверки неоднозначности.
- **Sources:** синтетические text/Markdown/HTML/PDF manifest fixtures с coverage `metadata`, `summary`, `partial`, `full`; две версии одного источника; receipt с ограничениями и несколькими locators.
- **Document conversion:** компактные синтетические RU/EN страницы: born-digital, скан с известным OCR expected text, повёрнутая страница, две колонки, таблица, формула, пустой/повреждённый текст. Файл manifest описывает checksum и expected quality signals; benchmark report фиксирует engine/version/options.
- **Security:** `..`, absolute paths, encoded traversal, symlink/junction escape, неожиданный destination overlap и приватные поля в test records.

## Отрицательные и fault-injection сценарии

1. YAML parser возвращает diagnostics на duplicate key; ни один byte источника не меняется.
2. Hash оригинала или source version не совпадает с receipt/locator; import либо update отклоняется и пишет diagnostic без перезаписи старого состояния.
3. Partial write или процесс прерван во время индексации/update/export; Foundation recovery оставляет согласованное состояние, повтор не создаёт дубликаты.
4. Конкурентная ручная правка совпадает с generated update; hash conflict сохраняет обе исходные данные для ручного разрешения, не проигрывает пользовательский текст.
5. Плохой converter output, malformed JSONL, timeout или остановленный worker: MCP core остаётся рабочим; исходник неизменен; незавершённые страницы не маркируются usable.
6. Поиск/traversal получает большой `limit`, depth, цикл, malformed cursor или устаревшую revision; API ограничивает работу и выдаёт контролируемую ошибку.
7. OKF/Obsidian export получает файл-ссылку за пределы workspace или пытается включить private assessment; операция блокируется до публикации output.

## Порядок запуска

1. На каждом K-task: сначала выбранный RED тест, затем полный файл K-task и его соседи.
2. После K1–K5: `node --test test/knowledge-format.test.mjs test/sources.test.mjs test/knowledge-index.test.mjs test/knowledge-search.test.mjs test/document-adapter.test.mjs test/knowledge-update.test.mjs test/knowledge-export.test.mjs`.
3. Python отдельно: `python -m unittest discover -s python/tests`. Если Python/Docling не установлены — adapter mocks всё равно обязательны; интеграционный OCR benchmark помечается как непроверенный.
4. Полная регрессия: `npm run verify` и `npm run check:prompts`.
5. Повторить полный автоматический gate на Node 20 и поддерживаемом актуальном LTS. Записать точные версии Node/Python, OS и реальные причины любого platform skip.
6. Ручной smoke test: открыть exported vault в Obsidian, пройти link navigation, проверить содержимое `Knowledge` и то, что `Personal` читается/редактируется как обычный Markdown. Это отдельная ручная запись, не подмена автоматизированного OKF/security gate.

## Критерии готовности тестирования

- Все KNW-1…KNW-10 имеют ссылку минимум на один PASS тест; P0 набор не содержит skip.
- `npm run verify`, prompt drift check и подходящий Node matrix завершаются с кодом 0.
- Для optional Docling отдельно записано `benchmark passed` с фикстурами и версией либо `not verified`; readiness нельзя заявлять без benchmark.
- Ни один тест не утверждает, что ссылка сама по себе подтверждает источник, summary — полный доступ, OCR heuristic — точность, или learner mastery — OKF `verified`.
