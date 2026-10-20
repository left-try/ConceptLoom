# ConceptLoom Courses — спецификация фазы 3

Дата: 13 октября 2026. Статус: подготовлена к реализации после прохождения Foundation и Knowledge gates.

Основание: [спецификация платформы](2026-10-12-conceptloom-learning-platform-design.md), [план общей реализации](../plans/2026-10-12-conceptloom-implementation.md), [план Courses C1–C5](../plans/2026-10-12-conceptloom-courses.md), [план Knowledge](../plans/2026-10-12-conceptloom-knowledge.md). Phase 2 spec and test-plan drafts currently live in the separate Knowledge worktree and must be reconciled before execution.

## Цель

Дать учащемуся непрерывный, управляемый им путь от практической цели до изучения курса: сохранить исходный профиль и диагностику, собрать персональный roadmap на основе реально доступных источников, получить отдельное согласие на roadmap и расписание, а затем выпускать уроки по одному в полноценных host chats. Состояние курса, происхождение материалов, согласия и dispatch должны переживать перезапуски и безопасно работать при повторных и параллельных вызовах.

## Пользовательский результат

Учащийся может начать курс по теме и цели, ответить на диагностические вопросы, просмотреть план с источниками и временными оценками, изменить его до согласия, запустить урок вручную либо включить поддерживаемое нативное расписание. Новый урок доступен как отдельная сессия, но незавершённый урок остаётся открытым для вопросов и не считается завершённым автоматическим запуском. При повторном запуске агент продолжает существующее состояние без незаметного выпуска дубликата.

## Область фазы

1. **Курс и профиль учащегося.** Versioned private course state, отдельные курсы и общий профиль; различение самоотчёта, предпочтения и подтверждённого assessment evidence; optimistic concurrency и доменные переходы.
2. **Исследование и roadmap.** Запись research receipts и привязок к импортированным источникам; создание персонального roadmap с зависимостями, длительностью и coverage; проверка готовности на основании содержимого, hash и locator, а не одного названия или syllabus.
3. **Редактирование, согласие и пауза.** Согласие привязано к показанному digest конкретной revision. Изменение цели, объёма, порядка или существенного содержания требует нового согласия. Расписание требует отдельного согласия с часовым поясом и политиками.
4. **Уроки и восстановление.** Идемпотентная выдача следующего подходящего урока, lease, publication receipt, resume capsule, продолжение Q&A и явное завершение по evidence.
5. **Host scheduling.** Проверяемые capability reports и receipts для фактически доступных native tools; не более одного active scheduler binding на course UID; fallback-инструкции, если хост не поддерживает требуемый сценарий.

## Вне области

- Импорт, индексирование и поиск источников как базовая возможность Knowledge-фазы; Courses использует её публичные контракты.
- Сценарии, интерактивный UI, coding labs и исполнение пользовательского кода (фаза 4).
- Полный педагогический evaluation suite, model judges, Promptfoo и release workflow (фаза 5).
- Собственный cron/scheduler, автономная модель/agent loop, скрытый background worker, crawler/downloader.
- Автоматическое скачивание платного или закрытого курса. Если содержимое недоступно, roadmap сообщает это и не притворяется source-grounded.
- Tracelet и LangGraph.

## Термины и модель данных

- **Course** — приватный объект с `uid`, `revision`, `status`, topic/goal, diagnostic, текущей `roadmapRevision`, уроками, source UIDs, consent records, progression и необязательной scheduler binding.
- **Learner profile** — общий профиль с наблюдениями `{field,value,basis,recordedAt,sourceAttemptId?}`. `basis` принимает `self-report`, `assessment` или `preference`. Предпочтения управляют подачей, но не mastery.
- **Lesson** — стабильный UID, title, objectives, concept UIDs, prerequisites, source bindings, упражнения, оценка времени и статус `pending|awaiting-learner|completed|blocked`.
- **Source binding** — source UID, точный content hash, locator, роль (`syllabus|teaching|example`) и coverage. Binding нельзя молча перенести на новую версию источника.
- **Roadmap revision** — неизменяемый digest представленного учащемуся набора уроков, порядка, целей, объёма и оценок времени. Любая значимая правка создаёт новую revision.
- **Consent record** — host, timestamp, user response и digest показанного содержания. Он не применяется к другому digest или другому типу согласия.
- **Dispatch receipt** — результат ручной/нативной публикации и идентификаторы run/chat/session, если хост их предоставляет. Неизвестный исход внешнего действия требует reconciliation.

Course lifecycle: `diagnostic → researching → roadmap-draft → approved → active → paused|completed`. Невыполненные readiness checks блокируют переход вперёд и возвращают машинно-читаемые blockers. Статус Knowledge-note не заменяет lifecycle курса.

## Функциональные требования и приёмка

- **CRS-1 — состояние и профиль.** Создание/чтение/обновление курса работает после перезапуска. Два курса могут разделять профиль, но сохраняют независимые progression. Самоотчёт не превращается в demonstrated mastery; preferences не оцениваются. Изменение с устаревшей revision завершается `REVISION_CONFLICT` без записи.
- **CRS-2 — инварианты lifecycle.** Общий patch не может напрямую установить approval, scheduler binding, active/completed или evidence. Только соответствующие доменные операции выполняют переход после проверки предусловий.
- **CRS-3 — достоверность research.** Course research сохраняет receipt, доступ, hash и provenance. Syllabus может информировать outline, но не подтверждает содержимое учебного материала. Урок с отсутствующим, несовпадающим или недостаточно доступным источником остаётся заблокированным/черновым; conflicting или uncertain sources показываются учащемуся.
- **CRS-4 — roadmap readiness.** Roadmap проверяет обязательные поля, уникальность UID, наличие prerequisites и отсутствие циклов; каждый обучаемый concept должен иметь применимый teaching binding или явный blocker. Roadmap персонализирован относительно learner frontier и не является копией syllabus.
- **CRS-5 — точное согласие.** Approval roadmap фиксируется только для exact digest показанной revision. Изменение существенной части плана требует повторного согласия. Одобрение расписания отдельно от roadmap; draft расписания не включает timer.
- **CRS-6 — безопасные projection edits.** Экспорт roadmap в Knowledge сохраняет ручной текст. Импортированная ручная правка возвращается как proposal; ожидаемый hash предотвращает перезапись; конфликт не меняет файл и требует разрешения/новой approval при изменении плана.
- **CRS-7 — расписание и capability.** IANA timezone, cadence, local time, missed-run и progression policies валидируются. На course UID допускается только одна активная binding. Timer становится active только после фактического native receipt, совпадающего с consented draft. Неподдерживаемый хост получает точную ручную инструкцию, а не ложное подтверждение.
- **CRS-8 — dispatch и прогресс.** Один lesson revision не публикуется повторно при replay или конкурентном запуске из двух host adapters. Lease имеет ограниченный срок и может восстановиться, если публикация точно не произошла. Неизвестный внешний исход не вызывает слепой retry. Урок ожидает учащегося после выдачи; completion требует допустимых evidence attempt IDs. Missed run не пропускает урок; paused/completed course отвечает no-op.
- **CRS-9 — resume.** Resume capsule включает goal, текущий lesson/step, learner context, источники с точными hashes/locators, due reviews, next step и digest prompt. Capsule ограничена (по умолчанию 16 000 символов); при превышении возвращает ссылки/diagnostics без потери обязательного контекста. Вопрос учащегося продолжает текущий урок.
- **CRS-10 — границы интеграции.** Core не вызывает модель, web search или native scheduler сам. Capability определяется результатом доступных инструментов. Отсутствующий host или optional integration не блокирует ручной dispatch. MCP stdout остаётся чистым JSON-RPC, malformed input не меняет state.

## Общие ограничения

- Node.js `>=20`, ES modules, `node:test`; private state хранится через транзакции и path containment Foundation.
- Импортированные источники и graph/read API берутся из завершённого Knowledge-контракта; покрытие `metadata|syllabus|summary|partial|full` остаётся явным.
- Существующие MCP contracts и tool names фазы 1–2 остаются совместимыми. Новые course tools регистрируются через общий tool registry.
- Codex, Claude Code Desktop и ChatGPT проверяются по фактическим host capabilities. Нельзя заявлять одинаковую scheduling/storage возможность без подтверждённого receipt и durable workspace.
- Любой внешний action, который нельзя надёжно определить после timeout/crash, сохраняется как `publication-unknown` и требует reconciliation.

## Готовность фазы

CRS-1…CRS-10 покрыты автоматизированными тестами и регрессионным gate; каждый C1–C5 incremental commit имеет зелёные целевые тесты. На доступных средах проходят Foundation/Knowledge suites и `npm run verify`. Реальные host scheduling сценарии отдельно подтверждены вручную в Codex и Claude Code Desktop; ChatGPT/cloud сценарий заявляется только после проверки доступа к стабильному workspace. Неподдержанные среды перечисляются как не проверенные, а не как pass.
