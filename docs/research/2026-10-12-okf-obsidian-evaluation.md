# OKF, Obsidian и оценка качества ConceptLoom

Исследование 12 октября 2026. Чтение первичных спецификаций и исходного кода, без запуска зависимостей или платных evals.

Решение после исследования: пользователь отложил подключение Tracelet. Ниже сохранены результаты аудита и возможные upstream задачи; в текущий план входят Promptfoo и локальные contracts/replay, без Tracelet SDK/importer/worker.

Проверенные версии: `left-try/okf-agent` commit `a87bb2186d831b75483a985ac670cda29d77fb31`; `left-try/tracelet` commit `83a07c8b4837e66d5b5b6cd91b2ff18e4759b13d`. Ссылки на код ниже закреплены за этими версиями.

## Общая библиотека знаний

Официальный [Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md) определяет Markdown с YAML frontmatter, обязательным `type`, ссылками, provenance, сведениями о создании/проверке и жизненном цикле. Дополнительные поля разрешены. `index.md` и `log.md` — зарезервированные документы; ID концепта определяется путем файла. Это совместимая основа для Obsidian.

Предлагается один набор файлов для двух читателей. Обычные относительные Markdown links — канонические: их понимают OKF consumers и Obsidian. Wikilinks принимаем при чтении пользовательских записей; автоматическая конвертация — только по запросу. Не создаем вторую редактируемую копию знаний для агента.

Объекты графа: Course, Lesson, Concept, Reference, Source Fragment, Exercise. Полная книга — один Reference, главы/значимые части могут иметь собственные Source Fragment узлы с locator и ссылкой на оригинал. Не превращаем каждый технический chunk в видимую заметку: chunks — индекс, значимые фрагменты — знания.

Связи отражают разные отношения: курс содержит урок; урок объясняет понятие; понятие требует предпосылку; источник поддерживает утверждение; программа курса помогла спроектировать roadmap; упражнение применяет понятие. Связь с источником означает использованный материал, а не автоматическое доказательство всех утверждений урока.

В body сохраняем обычные links и footnotes. Машинно типизированные отношения — расширение профиля ConceptLoom; стандартный OKF consumer продолжает читать обычные ссылки. `sources[].id` связывает утверждение с конкретным материалом; наш locator уточняет страницу/раздел. Читаемое описание ссылки остается в body.

Внешний источник сохраняет canonical URL и сведения о доступе. Если есть разрешенный файл/снимок, он помещается в переносимые assets. Если доступна только программа курса, записываем `syllabus-only`; не утверждаем, что скачали весь курс. Источник связывается с курсом и с теми уроками/понятиями, где использован.

`verified` означает проверку содержания, `mastery` — доказанное понимание учащегося. Это независимые характеристики. Eval «ссылка существует» не разрешает ставить `verified`; успешный ответ учащегося не делает факт проверенным человеком. Стандартные `status` draft/stable/deprecated не заменяем состояниями enrolled/completed — они относятся к расширению учебного профиля.

## Что действительно умеет okf-agent

Проект уже предоставляет repo-owned Markdown, сохранение curated текста вне generated blocks, SQLite FTS, инструменты MCP и локальную wiki. Однако это инструменты для сопровождения репозитория. Смотрите [knowledge.py](https://github.com/left-try/okf-agent/blob/a87bb2186d831b75483a985ac670cda29d77fb31/okf_agent/knowledge.py), [discovery.py](https://github.com/left-try/okf-agent/blob/a87bb2186d831b75483a985ac670cda29d77fb31/okf_agent/discovery.py) и [validation.py](https://github.com/left-try/okf-agent/blob/a87bb2186d831b75483a985ac670cda29d77fb31/okf_agent/validation.py).

Конкретные границы:

1. `discovery.files()` исключает `.okf`, принимает исходный код и manifests. Учебный Markdown не попадает в SQLite FTS; `.mjs` самого ConceptLoom тоже не входит в список suffixes.
2. `mcp.context()` отдельно ищет точное подстрочное совпадение в `.okf/*.md`. Это не полноценный поиск по понятиям, aliases и фрагментам.
3. Таблица `edges` хранит обнаруженные imports кода. Она не строит граф знаний из Markdown links, provenance или typed relations.
4. `validate()` проверяет свой manifest, generated markers и локальные links. Обязательный `type` официального OKF, parseable YAML и reserved-document semantics не валидируются. Нынешние шаблоны концептов без frontmatter нельзя считать conformant OKF v0.2 по этому валидатору.
5. Wiki зеркалит Markdown и строит список страниц, но не экспортирует учебные relations/backlinks. Freshness определяется полным набором источников wiki.
6. `find_root()` ищет Git root; `.okf` и `.okf-index` зафиксированы. Учебному vault нужна явная граница, иначе инструмент может выбрать родительский репозиторий.

Эти ограничения не мешают заимствовать lifecycle «прочитать → обновить → проверить». Прямое подключение текущего okf-agent не заменяет учебную библиотеку.

## Что действительно умеет Tracelet

Tracelet — Python библиотека Event/evaluator/outbox/worker. Есть пользовательские evaluators, retry и evaluator checkpoints, ограничения judge, comparisons и redaction. Метаданные Event уже позволяют переносить идентификаторы ConceptLoom. Источники: [Event](https://github.com/left-try/tracelet/blob/83a07c8b4837e66d5b5b6cd91b2ff18e4759b13d/src/tracelet/event.py), [capture API](https://github.com/left-try/tracelet/blob/83a07c8b4837e66d5b5b6cd91b2ff18e4759b13d/src/tracelet/api.py), [worker](https://github.com/left-try/tracelet/blob/83a07c8b4837e66d5b5b6cd91b2ff18e4759b13d/src/tracelet/worker.py).

Значимые для интеграции ограничения:

- В Node MCP нет Python runtime Tracelet. Подходит optional Python worker/importer для сохраненных событий; не требуется перенос всего продукта.
- `record()` ожидает долговременную запись. Поэтому MCP не должен синхронно ждать judge: локальная запись урока/события и фоновые evals имеют разный lifecycle.
- Модель вызывается приложением; MCP видит собственные tool events и переданный ему lesson output. Без host integration он не видит все ответы, system prompt, внутренние tools или token usage модели.
- [EvidenceReferenceEvaluator](https://github.com/left-try/tracelet/blob/83a07c8b4837e66d5b5b6cd91b2ff18e4759b13d/src/tracelet/evaluators/deterministic.py) использует regex по квадратным скобкам. Markdown link label/footnote не равнозначны source ID. Для ConceptLoom нужен parser-aware citation evaluator с locator resolution и отдельной проверкой смысловой поддержки.
- `JsonSchemaEvaluator` поддерживает ограниченное подмножество schema. Он не подходит как единственная проверка нашего полного контракта: часть schema keywords не исполняется. Используем валидатор заявленного dialect либо custom evaluator.
- FileStore рассчитан на локальное постоянное хранилище; решения для нескольких активных workers требуют проверки. At-least-once execution не означает exactly-once вызовы внешних judges.
- Query/export CLI отсутствует. Candidate comparisons есть, включая `swap_order`; при несогласии двух порядков код возвращает tie. В eval report нужно сохранять отдельное расхождение порядка, а не считать его доказанным равенством качества. [comparison.py](https://github.com/left-try/tracelet/blob/83a07c8b4837e66d5b5b6cd91b2ff18e4759b13d/src/tracelet/comparison.py).

## Promptfoo и распределение ответственности

Promptfoo поддерживает custom JS/Python assertions, custom providers и оценку сохраненных outputs. `providerOutput` позволяет пропустить provider call; `--model-outputs` — проверять готовые ответы. При этом model-graded assertions могут вызывать judge: отсутствие generation не означает отсутствие платных вызовов. Источники: [config reference](https://www.promptfoo.dev/docs/configuration/reference/), [assertions](https://www.promptfoo.dev/docs/configuration/expected-outputs/), [custom provider](https://www.promptfoo.dev/docs/providers/custom-api/).

| Слой | Предлагаемый инструмент | Результат |
|---|---|---|
| Формат, storage, ссылки, concealment, idempotency | Локальные contract tests и validators ConceptLoom | Детерминированные invariants |
| Объяснение, адаптация, grounding, roadmap | Promptfoo + фиксированные cases/rubrics | Сравнение промптов и моделей до выпуска |
| Реальные сохраненные уроки и попытки | Локальный JSONL replay; Tracelet рассмотрен и отложен | Воспроизводимая оценка сохраненных артефактов |
| Знания, происхождение и freshness | OKF profile и в будущем okf-agent knowledge mode | Проверяемая библиотека для человека и агента |

Eval результаты — служебные артефакты. Их краткая интерпретация может быть отдельной заметкой, связанной с уроком. Закрытые criteria, решения, ответы и личные данные не публикуются в общем knowledge bundle автоматически. Низкий score не изменяет mastery или содержание заметки без отдельного решения.

## Конкретные задачи для upstream

Ниже предложения, а не команды, которые уже существуют. Внешние репозитории не изменялись.

### okf-agent: отдельный knowledge-bundle profile

**Цель:** обслуживать произвольный Markdown corpus с официальной OKF совместимостью, сохранив действующий repository profile.

- Конфигурация явного bundle root/index root, без обязательного Git и без записи coding instructions/hooks при режиме библиотеки.
- Индексация body, frontmatter, aliases и source locators; FTS по Markdown. Unknown fields/types сохраняются.
- Link parser для относительных Markdown links, `/` bundle-relative links и optional wikilinks; escaped spaces, anchors, fenced code, embeds и одинаковые filenames покрываются fixtures.
- Граф directed links/provenance с optional typed relations; backlinks и bounded neighborhood query через CLI/MCP.
- Проверка OKF v0.2: YAML + `type`, index/log, optional families; broken links дают diagnostic, а не ошибку стандартной conformance. Отдельный strict ConceptLoom readiness profile может блокировать неготовый roadmap.
- Предсказуемый round-trip: пользовательский body и неизвестные YAML keys сохраняются; generated update сверяет revision/hash и не заменяет ручную правку.
- CLI/MCP JSON export узлов, связей, provenance и результатов валидации.

**Приемка:** учебный bundle без Git индексируется; source → lesson → course traversable; импорт разрешенного unknown type проходит; двусмысленная ссылка получает diagnostic; ручная заметка и неизвестные поля переживают update. Старые repo commands продолжают работать.

**Последовательность:** bundle root + Markdown FTS + OKF validation — минимальный полезный этап; relations/backlinks/export — следующий. ConceptLoom может создать свои узкие adapters до готовности upstream, используя тот же profile contract.

### Tracelet: удобный offline ingestion/reporting

**Цель:** оценивать артефакты приложений, написанные вне Python-процесса, и переносить результаты в regression suite.

- JSONL importer с `Event.from_dict`, quarantine ошибочной строки и продолжением остальных; stable job ID из eventId + evaluatorSetVersion. Повторный импорт idempotent.
- Query/export completed/error/skipped results по datasetId, courseId, lessonId, prompt digest, evaluator version и source hashes.
- Offline worker/run CLI с явным разделением deterministic и judge режима; exit code не считает skipped/error успешными.
- Citation parser или расширяемый extraction callback вместо regex-only при работе с Markdown; присутствие ссылки и entailment остаются разными метриками.
- Для unsupported JSON-schema keyword возвращать явную unsupported/error диагностику либо optional standards-compliant adapter; не давать ложный pass.
- Pairwise результат дополнить `order_consistent`/`order_disagreement`; сохранять обе оценки и происхождение judge.
- Node-to-Python bridge example: Event JSONL → worker → evaluation result JSONL. Никаких предположений о перехвате скрытых вызовов чужого приложения.

**Приемка:** повторный импорт не повторяет уже завершенную evaluator revision; поврежденная строка не теряет остальные events; невозможно принять ошибку judge за pass; Markdown footnotes разрешаются к source IDs; экспорт читается адаптером Promptfoo.

Первые три пункта улучшат интеграцию сильнее отдельного JavaScript SDK. Специфичные педагогические rubrics и ConceptLoom schemas остаются в ConceptLoom, а не становятся обязательной частью Tracelet.

## Рекомендация

Одобренная архитектура дополняется единым Obsidian/OKF набором знаний и отдельным eval слоем. LangGraph и интеграция Tracelet отложены. Promptfoo используется для regression и оценки сохраненных ответов; okf-agent пригоден после добавления knowledge profile. Ни один из этих инструментов не является условием чтения Markdown пользователем.
