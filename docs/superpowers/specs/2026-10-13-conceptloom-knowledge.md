# ConceptLoom — спецификация фазы 2: Knowledge

Дата: 13 октября 2026. Статус: контракт для планирования реализации по SDD/TDD.

Основание: [спецификация платформы](2026-10-12-conceptloom-learning-platform-design.md), [спецификация Foundation](2026-10-12-conceptloom-foundation.md), [исследование OKF/Obsidian](../../research/2026-10-12-okf-obsidian-evaluation.md), [план Knowledge](../plans/2026-10-12-conceptloom-knowledge.md).

## Цель

Дать учащемуся переносимую библиотеку знаний, в которой исходные материалы, извлечённый текст, заметки, происхождение утверждений и связи между понятиями сохраняются раздельно и доступны одновременно ConceptLoom и Obsidian. Пользователь может импортировать разрешённый источник, видеть фактическое покрытие и ограничения доступа, находить заметки и фрагменты по смысловым терминам/aliases, проходить по графу и переносить библиотеку без потери ссылок или личных записей.

## Результат фазы

- Один Markdown vault с conformant OKF v0.2 bundle в `vault/Knowledge` и отдельной пользовательской областью `vault/Personal`.
- Повторяемый source pipeline: manifest, research receipt, неизменяемые версии оригиналов, извлечённые артефакты, chunks и устойчивые locators.
- Локальные инструменты чтения, полнотекстового поиска и ограниченного обхода графа.
- Безопасное обновление generated блоков с hash-конфликтами вместо потери ручных правок и relocatable export в OKF/Obsidian.
- Опциональная подготовка PDF/документов с явным качеством результата и происхождением каждой страницы; плохое извлечение нельзя выдавать за проверяемый фрагмент.

## Требования и проверяемые критерии

- **KNW-1 — OKF bundle.** Все обычные Markdown-файлы Knowledge имеют валидный YAML и `type`; зарезервированные `index.md`/`log.md` соблюдают OKF v0.2. Round-trip сохраняет неизвестные стандартные поля, типы и body. Повреждённый YAML не переписывается. `verified` не выводится из mastery учащегося.
- **KNW-2 — раздельные области.** Инициализация создаёт Knowledge и Personal идемпотентно, не перезаписывает существующие файлы. Personal не входит в OKF conformance и не индексируется в Knowledge по умолчанию. Запрос на включение Personal в OKF export требует явного преобразования.
- **KNW-3 — provenance и версии источника.** Импорт сохраняет canonical resource, receipt, coverage, content hash и режим хранения. Повтор того же импорта идемпотентен; новая версия сохраняется рядом со старой. Locator всегда относится к точному content hash и не переезжает на новую версию автоматически.
- **KNW-4 — честность доступа и извлечения.** Metadata, summary, partial extraction и raw/full content различимы в данных и ответах. Наличие syllabus или summary не означает, что полный источник прочитан. Неизвестный coverage/status не повышается автоматически. Chunks не маскируются под авторские заметки.
- **KNW-5 — локаторы и source preparation.** Сегментация предпочитает главы/страницы/заголовки и сохраняет source UID, content hash и locator; длинные фрагменты делятся по абзацам. Исходный asset не изменяется. Ошибка или пропуск extraction видны как diagnostics.
- **KNW-6 — преобразование документов (optional runtime).** MCP core работает без Python/Docling. При установленном converter обработка изолирована процессом, возобновляема и выдаёт по страницам `usable`, `needs-review` или `failed` с наблюдаемыми сигналами качества. Низкокачественная страница не может служить проверяемым evidence без ручной проверки. Timeout/ошибка не меняет оригинал и сохраняет уже готовые страницы.
- **KNW-7 — граф и поиск.** Обычные относительные Markdown links и типизированные relations дают bounded traversal; wikilinks принимаются, но неоднозначное совпадение только диагностируется. Кодовые fences не создают links. Поиск учитывает Unicode, title, aliases и содержимое, имеет ограниченные результаты и стабильную пагинацию/ranking для неизменного индекса. Personal и приватные assessment данные по умолчанию отсутствуют в Knowledge graph/search.
- **KNW-8 — конфликтобезопасное редактирование.** Update использует ожидаемый hash и workspace transaction из фазы 1. Hash mismatch, дублированные/повреждённые generated markers и невалидный YAML оставляют файл неизменным. Пользовательский текст и неизвестные metadata сохраняются.
- **KNW-9 — portable export.** OKF export содержит только Knowledge bundle и доступные bundle assets. Obsidian export может дополнительно включать Personal только по явному запросу. Перенесённый vault сохраняет относительные ссылки; traversal/symlink escape блокируется. Внешние и отсутствующие assets явно перечислены как непереносимые зависимости; private assessment и events исключены.
- **KNW-10 — необязательные интеграции.** Отсутствующий upstream backend не блокирует локальную реализацию. Не изменять внешние репозитории, не подключать Tracelet, не скачивать материалы самостоятельно и не запускать платные evals.

## Границы

В фазу входят K1–K5: OKF format/profile, source import и chunking, graph/index/search/read, опциональная document conversion/OCR, conflict-safe update и export.

Не входят: course lifecycle/approvals/scheduling и генерация учебного roadmap из графа (фаза 3); HTML UI, программные упражнения и пользовательский код (фаза 4); полный pedagogical eval suite, model judges и Promptfoo release workflow (фаза 5); автоматический web crawler/downloader, vector database, embeddings, Tracelet и изменение upstream проектов.

## Ограничения реализации

- Node.js `>=20`, ES modules и `node:test`; Python converter — отдельная необязательная часть.
- OKF v0.2 — стандартная conformance; ConceptLoom profile добавляет `profile`, `uid`, `aliases`, typed `relations`, `locator`, `access`/`coverage` и не переопределяет семантику OKF.
- Markdown в Knowledge — авторский источник истины. Manifest, chunks и индексы — технические производные данные. Оригиналы immutable; extraction имеет собственный hash и версию.
- Пути, локаторы и exports проверяются в пределах workspace. Существующие MCP/JSON-RPC контракты фазы 1 остаются совместимыми.
- Проверки для внешнего приложения (ручная навигация в Obsidian) фиксируются отдельно от автоматизированного gate. Необязательный runtime без установленного движка отмечается как не проверенный integration gate, а не PASS.

## Приёмка

KNW-1…KNW-10 покрыты тестами из [плана тестирования](../plans/2026-10-13-conceptloom-knowledge-test-plan.md). Целевые тесты и полный `npm run verify` проходят; generated prompt references не имеют drift. Проверки source security, conflict safety, приватности и truthfulness не имеют пропусков. Optional Docling integration имеет отдельный локальный benchmark с RU/EN фикстурами либо явно остаётся неподтверждённой и не заявляется как готовая возможность.
