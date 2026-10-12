# ConceptLoom: переносимое обучение, граф знаний и оценка качества

Дата: 12 октября 2026. Статус: проект письменной спецификации для review после одобрения общего направления. Реализация и результаты тестирования этим документом не заявляются.

Основание: [первичный аудит](../../research/2026-10-12-conceptloom-evolution.md) и [исследование OKF/Obsidian/evals](../../research/2026-10-12-okf-obsidian-evaluation.md).

## 1. Принятые решения

- Codex/ChatGPT и Claude Code Desktop поддерживаются одновременно через общие данные и отдельные host adapters.
- Сохраняется Node MCP core; Python добавляется для документных конвертеров и опционального evaluation worker. LangGraph и собственный agent loop отложены.
- Промпты организуются по OPF, знания — по официальному OKF v0.2 с учебным профилем ConceptLoom.
- Один набор Markdown знаний читают агент и Obsidian. Найденные книги, статьи, документация и программы курсов становятся узлами со связями к урокам, курсам и понятиям.
- Полный текст/оригинал источника, структурированное знание, поисковый индекс и evidence учащегося имеют разную ответственность.
- Расписание включается после явного согласия учащегося с параметрами. Предварительное создание course draft или schedule draft не включает таймер.
- Promptfoo обеспечивает regression evals; Tracelet — optional evaluation сохраненных артефактов. Работа без этих tools остается возможной.

## 2. Цель и критерий результата

Пользователь говорит «хочу изучить тему», получает диагностику уровня и основанный на прочитанных материалах roadmap, согласует его и расписание. Каждый новый scheduled chat получает контекст курса, объяснение и практику. Пользователь отвечает и задает вопросы в этом же чате. Источники и личные заметки доступны через связанный vault; следующее занятие учитывает выполненные попытки.

Полнота объяснения: цель, предпосылки, причинные переходы, разобранный пример, существенные ограничения, практика и конкретные ссылки. Размер соответствует уровню и задаче. Служебное подтверждение не превращается в урок.

Качество выпуска подтверждается отдельно: соблюдение contracts, пригодность объяснений, основание утверждений в источниках, отсутствие раскрытия решения, сохранение памяти и поведение обоих приложений. Наличие файлов или высокий judge score не доказывают реальное усвоение.

## 3. Границы компонентов

| Компонент | Ответственность | Вход/выход |
|---|---|---|
| Host adapter | Модель, поиск/fetch, вопросы, native scheduler, показ материала | capabilities, research receipt, lesson output, schedule receipt |
| MCP learning core | Checkpoints, состояния, course dispatch, evidence, public/private separation | Версионированные JSON tool contracts |
| Knowledge library | OKF nodes, ссылки, provenance, чтение/обновление | Markdown source + derived graph/search index |
| Source pipeline | Импорт, сохранение, extraction/OCR, chunks/locators | Source manifest + assets + prepared artifacts |
| Prompt catalog | OPF sources и сборка инструкций адаптеров | Prompt ID/digest и static references |
| Presentation | Semantic Mermaid, HTML views, text fallback | Общие diagram/exercise data |
| Evaluation | Cases, assertions, rubrics, capture, optional judges | Versioned events/results; не учебная mastery |

MCP core не создает чат через выдуманный универсальный MCP method. Приложение выполняет native action и возвращает receipt; при отсутствии action предлагается явная настройка пользователем. Capability support определяется фактически доступными tools и protocol negotiation.

## 4. Структура workspace и источник истины

```text
learning-workspace/
  vault/                          # пользователь открывает эту папку в Obsidian
    index.md                      # обычная навигация по vault
    Knowledge/                    # один conformant OKF bundle
      index.md                    # optional okf_version: "0.2"
      log.md
      courses/<courseUid>.md
      lessons/<lessonUid>.md
      concepts/<conceptUid>.md
      references/<sourceUid>.md
      fragments/<fragmentUid>.md
      exercises/<exerciseUid>.md   # только публичная постановка
      assets/<sourceUid>/original.<ext>
      assets/<sourceUid>/extracted.txt
      assets/<sourceUid>/structure.json
    Personal/                     # свободные заметки пользователя, вне OKF bundle
  .concept-loom/
    profile.json
    sessions/<sessionId>.json
    courses/<courseUid>.json       # учебные progression/approvals
    sources/catalog.json
    sources/<sourceUid>.json       # импорт, extraction, access/coverage
    chunks/<sourceUid>.jsonl
    indexes/knowledge.json
    events/<courseUid>.jsonl
    runs/<runUid>.json
    assessments/                  # приватные grading criteria и карточки
    evaluation/events.jsonl
    evaluation/results.jsonl
  exercises/<exerciseUid>/         # starter files и артефакты попыток
```

Авторское содержание, утверждения, их provenance и relations — Markdown в Knowledge. Course roadmap/progression, approvals, attempts и scheduler bindings — private state. Public roadmap/lesson projections формируются из соответствующего state и помечены generated; новая пользовательская правка обнаруживается до обновления. Правка generated roadmap в Obsidian становится предложением изменения private roadmap, требует сверки и нового согласования; она не теряется при следующей генерации и не включает расписание сама.

Индексы, chunks и UI — производные, пересоздаются из источников и содержимого. Ни SQLite, ни embeddings не являются единственным экземпляром пользовательских знаний. Оригинальные assets неизменны; text extraction хранится отдельно и имеет свой хеш/версию.

Personal принимает обычный Markdown без frontmatter и wikilinks. Агент может читать/индексировать его по настройке workspace; строгую OKF conformance к нему не применяет. При включении личной заметки в OKF export требуется явное действие, добавляющее type/метаданные и сохраняющее body. Скрытая переупаковка пользовательских записей запрещена.

Экспорт vault переносит Knowledge и Personal с относительными links и доступными assets. Экспорт OKF переносит только bundle и его assets. Приватные ответы, рубрики, runtime события и профиль не включаются. Metadata-only материалы остаются external references. Большие исходники, сохраненные по ссылке вне vault, обозначаются как непереносимые зависимости; export не утверждает наличие их копий.

## 5. Профиль знаний ConceptLoom/1

Официальный стандарт: [OKF v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md). Используем `type`, `title`, `description`, `resource`, `tags`, `sources`, `generated`, `verified`, `status`, `stale_after` согласно стандарту. Дополнительные поля сохраняются при round-trip.

Типы: Course, Lesson, Concept, Reference, Source Fragment, Exercise. Unknown type остается читаемым generic node. Concept ID официального OKF — путь без `.md`; дополнительный `conceptloom.uid` — стабильная идентичность внутри продукта. Имя файла содержит этот uid и не меняется при редактировании title. Явный перенос файла обновляет path lookup и связанные links с проверкой conflicts.

Учебное расширение `conceptloom`:

- `profile: conceptloom/1`, `uid`, optional `aliases`;
- `relations`: список `{kind, target}` с bundle-relative target без начального `/`;
- optional `locator`: source UID, физическая страница/printed label, section/heading, bbox, timestamps либо code revision/lines;
- optional `access`/`coverage`: фактически прочитанное/сохраненное содержимое;
- optional `projection_revision`: версия generated представления состояния.

Точный набор enum/schema keys профиля фиксируется рядом с реализацией; additions меняют minor profile version, изменения смысла — major. Typed targets разрешаются от корня Knowledge; обычные body links и sources paths разрешаются согласно OKF. Эти две системы не смешиваются неявно.

Canonical links в body — обычные относительные Markdown links с percent-encoding нужных символов. Obsidian отображает их и backlinks. При чтении поддерживаются wikilinks пользователя; неоднозначный basename не выбирается автоматически. Cross-profile links в Personal разрешаются для vault navigation, но не становятся обязательной зависимостью conformant OKF export.

Значимые отношения:

| kind | Пример |
|---|---|
| contains | Course → Lesson |
| teaches | Lesson → Concept |
| requires | Lesson/Concept → prerequisite |
| uses-source | Course/Lesson → Reference |
| informed-by | Course → syllabus Reference |
| supported-by | Claim/Concept → Source Fragment/Reference |
| fragment-of | Source Fragment → Reference |
| exercises | Exercise → Concept |
| example-of / contrasts-with | Concept → Concept |

Standard readers получают отношения из видимых body links. Профиль добавляет типы, проверку target и возможность bounded traversal. Производный граф хранит from/to/kind, где обнаружено ребро, source hashes и diagnostic. Извлечение body links, provenance и relations не создает дубли одного ребра, но сохраняет несколько мест происхождения.

Смысловой граф может иметь циклы. Подграф prerequisites и порядок уроков должны быть ацикличны. Standard conformance допускает broken links; они отображаются как diagnostics. Readiness утверждаемого roadmap требует разрешить обязательные prerequisites/source dependencies либо явно обозначить материал как еще недоступный и остановить активацию зависящего урока.

`index.md` и `log.md` соблюдают reserved semantics. Root index может объявлять okf_version, остальные index не получают frontmatter. Log имеет date headings YYYY-MM-DD. Остальные Markdown внутри Knowledge имеют type. Сырые extraction artifacts используют `.txt`/JSON либо полноценный Reference wrapper, чтобы не засорять bundle неконформными `.md`.

### Иллюстрация заметки, не готовый учебный материал

```yaml
---
type: Concept
title: Использование инструментов агентом
description: Как агент выбирает действие и получает результат инструмента.
tags: [agents, tools]
status: draft
sources:
  - id: tools-docs
    resource: ../references/source-tools-docs.md
    title: Документация по вызовам инструментов
conceptloom:
  profile: conceptloom/1
  uid: concept-tools
  relations:
    - kind: supported-by
      target: references/source-tools-docs.md
---
```

Body этой заметки содержит разобранное объяснение, видимую ссылку на Reference и footnote `[^tools-docs]` у атрибутируемого утверждения. Имена и источник здесь иллюстративные; реальный импорт должен создать Reference и подтвердить покрытие нужного утверждения. Здесь специально нет `verified`: наличие источника и generated текста не доказывает проверку.

## 6. Источники и их граф

Source manifest содержит uid, canonical resource, автор/название/язык/версию, access timestamp, content hashes, coverage, original storage mode, extraction tool/options и status/error. Manifest владеет техническими записями импорта и extraction; Reference note владеет авторским описанием применимости и provenance утверждений. Технические факты показываются в generated блоке Reference с revision/hash. Изменение этого блока обнаруживается как конфликт, а не молча перезаписывается. Индекс читает Reference и manifest по их общей source UID; это не две независимо редактируемые копии знаний.

Source Fragment создается для главы, раздела или значимого фрагмента, к которому нужен устойчивый переход. Chunks остаются техническим индексом. Locator обязан вести к конкретной версии материала; при замене версии предыдущий fragment остается историческим либо deprecated, не начинает указывать на другую страницу молча.

Источник может связываться одновременно с несколькими курсами и понятиями. У программы чужого курса записывается, что она помогла определить roadmap, и какие темы были адаптированы. Не приписываем программе содержание закрытых уроков.

Research receipt фиксирует query, opened resource, полученный формат (raw/extracted/summary/metadata), hash/locator, coverage и ограничения. В course mode поиск и фактическое открытие основных материалов обязательны. При недостаточном доступе создается research draft; перед активацией источник читается либо заменяется с обновлением roadmap.

Native fetch адаптер пользуется инструментами приложения; воспроизводимый import принимает возвращенный контент/файл и receipt. Optional downloader имеет лимиты размера, времени и доменов. OCR/Docling pipeline выполняется отдельным Python процессом, по страницам, с checkpoint и provenance. Выбор engine подтверждается на эталонных русско-английских документах.

## 7. Состояние, память и запись

Profile содержит цель/уровень/предпочтения с основанием и временем изменения. Course — versioned roadmap, prerequisites, approvals, source bindings и progression. Lesson — текущий шаг, вопросы/попытки, resume capsule. Evidence ledger хранит попытки, hints, формат, dimension, confidence, rubric version и review timing.

Persistence API различает patch и full snapshot. Отсутствие массива в patch сохраняет предыдущее значение. expectedRevision и уникальный attemptId предотвращают lost update и повторную оценку. Local writes защищены межпроцессной блокировкой; temporary path уникален на вызов. Карточка расходуется только после validate и успешной фиксации assessment. Ошибка persistence оставляет recoverable попытку.

Schema v1/v2 читается, миграция создает backup и не теряет route/evidence. Записи журнала имеют eventId и состояние commit/recovery, чтобы событие и state не расходились молча. Для нескольких объектов используется storage transaction interface; backend реализует заявленные guarantees. SQLite рассматривается при реализации транзакционного слоя, без зависимости модели знаний от него.

Редактирование знания сравнивает хеш перед записью, сохраняет неизвестные YAML keys и пользовательский body. Machine-owned block имеет явные markers. Malformed/duplicate markers приводят к diagnostic и остановке обновления файла, а не удалению текста. Добавление ссылки не разрешает переписывать авторское объяснение пользователя.

## 8. Курс и расписание

Course lifecycle: diagnostic → researching → roadmap-draft → approved → active → paused/completed. OKF status описывает документ, а этот lifecycle хранится в private state. Roadmap revision связан с записью согласия; изменение цели/объема/порядка требует показать обновление учащемуся.

Schedule draft содержит host, IANA timezone, cadence, локальное время, missed-run policy, рабочее хранилище и lesson progression policy. Активация требует явного согласия и native receipt. Только один scheduler binding активен на course UID, даже если оба host adapters установлены.

Dispatch получает lease и next eligible lesson, используя `(courseUid, lessonUid, roadmapRevision)` как ключ идемпотентности. Сохраняются host chat/session ID при доступности, опубликованный lesson artifact и capsule. Автономный запуск заканчивается в awaiting-learner. Ответы и вопросы учащегося продолжают этот lesson; новое время расписания не имитирует завершение задания.

По умолчанию следующий выпуск учитывает незавершенный урок; независимая рассылка следующих уроков — явно выбранная политика. Пропущенный запуск не перескакивает через уроки. При отсутствии host pause tool завершение курса остается сохраненным, а следующему запуску возвращается no-op и действие для выключения таймера.

Native tasks обоих приложений проверяются вручную в реальном UI после готовности ручного dispatch. Local memory имеет стабильный workspace root; отдельные worktrees/cloud clones не создают автоматически независимые профили.

## 9. Промпты, графика и практика

OPF catalog: diagnose, research-course, plan-course, teach-lesson, practice, resume. Source digest записывается в lesson capture. Static skills/references генерируются из catalog и проверяются на drift. Подстановка inputs не создает неявных system полномочий внутри приложения.

Semantic diagrams содержат nodes/edges/status labels. Mermaid — стандартное представление зависимостей; HTML — для действий, раскрытия деталей и симуляций. UI theme/capabilities задает приложение. CLI получает текстовый fallback. Виджет knowledge graph может показать source/course/lesson nodes и открыть конкретный файл; большой граф загружается частями.

Practice включает scenario, simulation, coding lab. Public exercise и private grading отделены. Browser state не заменяет evidence. Попытка отправляется через host/MCP bridge или explicit export; после проверки фиксируются результат и exact resume action. HTML без серверного grading может быть self-check, но не обещает спрятанных ответов.

Coding execution — отдельный adapter с лимитами и изоляцией; ordinary MCP process не исполняет произвольный Python/shell. Недоступный executor ведет к разбору присланного кода/артефакта с обозначением, что выполнение не проверено.

## 10. Evaluation contract

Детерминированная корректность, качество преподавания и evidence учащегося — разные оценки. Общий Event/Result contract позволяет запускать offline suite и наблюдать сохраненные реальные материалы.

Capture event содержит eventId, eventType, parent/run IDs, course/lesson/node IDs, host, prompt ID/digest, knowledge profile version, source hashes, доступный вход/выход и timestamp. Сведения о модели, token usage, generation latency сохраняются только при фактической доступности. Tool duration не выдается за model latency. Не сохраняются скрытые рассуждения или приватные критерии в public capture.

Event types: research-completed, roadmap-proposed, lesson-published, source-prepared, knowledge-updated, practice-assessed, state-restored, dispatch-result. Для Tracelet адаптер использует `Event.request_id = eventId`, input/output, context с явно разрешенными evidence snippets, tags и metadata. Стандартные evaluator names/versions и статусы completed/error/skipped сохраняются.

Локальный outbox не зависит от доступности Tracelet. Optional Python importer оценивает события после их фиксации. Ошибка eval не блокирует сохранение попытки учащегося и не считается pass. Ошибка записи самого outbox становится видимой diagnostic; основной state commit не отменяется и recoverable capture создается из committed артефакта.

### Suite первого этапа

Предлагается 48 cases: 24 structural/workflow cases и 24 зафиксированных учебных ответа с ручной разметкой. Это план набора, fixtures еще не созданы. Набор включает русский и английский, начинающих и опытных учащихся, конфликт источников, частичный доступ, resumed lesson и malformed output.

| Проверка | Метод | Критерий |
|---|---|---|
| OPF/OKF и JSON contracts | Parser + schema | 100% обязательных invariants |
| Course/source/fragment navigation | Fixture graph + locators | Все обязательные links разрешаются |
| Grounding | Сверка source IDs/locators + rubric | Существование и смысловая поддержка измеряются отдельно |
| Учебное объяснение | Human labels + optional judge | Механизм, пример, соответствие уровню, ограничения |
| Скрытие ответа | Public artifacts + workflow trace | Ни одного преждевременного solution/criteria leak |
| State/dispatch | Restart, conflicts, duplicate run | Нет потерянной попытки и дубля урока |
| Notes round-trip | Edit/reindex/export/reopen | Пользовательский текст и unknown keys сохранены |
| Practice | Attempt artifact и checks | Результат связан с правильным exercise/version |

Каждая педагогическая dimension имеет шкалу 0–3: отсутствует/ошибочна; частична; корректна; корректна и пригодна для заданного уровня. Для допустимого ответа обязательные mechanism/example/level/grounding dimensions не ниже 2. Сильный общий score не компенсирует ложную цитату или раскрытый ответ. Rubric фиксирует rationale и supporting excerpt.

Promptfoo использует OPF-loaded messages через adapter либо recorded outputs. Offline deterministic mode не вызывает providers/judges. Model mode конфигурирует model/credentials/budget отдельно и сравнивает одинаковый case matrix. Judges сначала проверяются на holdout ручных labels; ungraded/error/skipped не включаются в успешные результаты. Нет обещания доказать улучшение обучения по одному judge score.

Tracelet поначалу не запускает shadow candidates автоматически. Sampling/caps, redaction и retention задаются явно. Replay/report использует источник того же content hash; когда он отсутствует, результат inconclusive/error, а не искусственно восстановленный контекст.

Generated KB validation checks не дают verified по смыслу. Semantic review может создать отдельно атрибутированную verification event только с отмеченными claims/source scope и content hash. User mastery изменяется assessment policy, не eval worker.

## 11. Интеграции и зависимости upstream

okf-agent knowledge profile — optional implementation backend для indexing/validation/traversal. До его готовности ConceptLoom реализует узкий контракт локально. Требования и приемка вынесены в [upstream предложения](../../research/2026-10-12-okf-obsidian-evaluation.md#конкретные-задачи-для-upstream).

Tracelet current API уже позволяет custom evaluator и capture через Python. JSONL ingestion/reporting улучшит удобство; это не блокирует собственный маленький importer. Педагогические rubrics и typed educational relations остаются в ConceptLoom.

## 12. Разбиение реализации

1. **Foundation:** OPF catalog/build, качество объяснений, исправления persistence/checkpoint lifecycle, semantic Mermaid, evaluation contracts и deterministic fixture suite.
2. **Knowledge:** shared OKF profile, source manifests/assets/chunks, Markdown index/traversal, Obsidian export, конфликтобезопасные updates, optional Python extraction/OCR.
3. **Courses:** диагностика/research receipts, roadmap, approvals, ручной dispatch/capsule; затем обе native scheduling integrations.
4. **Practice/UI:** HTML graph/scenarios/simulations, server assessment bridge, ограниченный coding execution.
5. **Evaluation expansion:** Promptfoo human-labeled teaching cases и optional Tracelet worker/reporting. Контракт и базовые проверки уже вводятся в Foundation, оценка не откладывается до конца продукта.

Для каждого этапа нужен исполняемый план с файлами, contract fixtures и критериями приемки. Общая спецификация задает границы; она не заменяет этот план и не разрешает объявлять завершенными отсутствующие host integrations.

## 13. Review и реальные ограничения

Согласовано пользователем: оба приложения, общие данные, основной учебный сценарий, граф найденных источников, отложенный LangGraph. Конкретный письменный контракт здесь еще ожидает review.

Установки зависимостей, правки upstream, расписания и запуск paid evals не выполнялись. Методы upstream и CLI flags, перечисленные как пожелания, не являются существующими API. API/app модель для generation evals будет выбрана при настройке; offline contracts не требуют provider credentials.
