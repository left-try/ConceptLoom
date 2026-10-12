# ConceptLoom Foundation — спецификация фазы 1

Дата: 12 октября 2026. Статус: подготовлена к реализации по SDD/TDD.

Основание: [спецификация платформы](2026-10-12-conceptloom-learning-platform-design.md), [общий план реализации](../plans/2026-10-12-conceptloom-implementation.md), [план Foundation](../plans/2026-10-12-conceptloom-foundation.md).

## Цель

Фаза 1 делает существующий учебный цикл надёжной основой для следующих фаз: пользовательское состояние переживает частичные обновления и сбои; оценка checkpoint записывается ровно один раз; host-инструкции генерируются из проверяемого OPF-каталога; связи знаний можно представить типизированной Mermaid-диаграммой; критические события можно сохранять и проверять локально без внешнего evaluation-сервиса.

## В область фазы входят

1. **Workspace и транзакционная запись.** Стабильный workspace root, проверка путей внутри root, patch/snapshot semantics, проверки revision/hash, межпроцессная сериализация, журнал восстановления и миграция schema v1/v2 с backup.
2. **Checkpoint и evidence.** Проверка ответа не раскрывает приватный ключ до assessment. Попытка, обновлённое learning state и receipt сохраняются согласованно; повтор с тем же `attemptId` идемпотентен, несовпадающий повтор конфликтует. Карточка расходуется только после успешной фиксации.
3. **OPF и качество урока.** Шесть промптов (`diagnose`, `research-course`, `plan-course`, `teach-lesson`, `practice`, `resume`) читаются из общего каталога. Generated host references проверяются на drift; пользовательские inputs подставляются в body, не меняя структуру сообщений. Урок содержит цель, предпосылки, механизм, разобранный пример, ограничения, практику и ссылки на источники, когда они доступны.
4. **Диаграммы и transport registry.** Типизированные nodes/edges дают детерминированный Mermaid с безопасными labels; сохраняется совместимость с legacy-входом и stdio JSON-RPC.
5. **Evaluation contracts и локальный capture.** Versioned schemas для событий и результатов, allowlist публичных полей, дедупликация событий по `eventId`, восстанавливаемый capture после сбоя и первые 8 structural/workflow fixtures. Работа обучения не зависит от Promptfoo или внешней tracing-библиотеки.

## Вне области

- Импорт/парсинг источников, OKF vault и Obsidian-интеграция (фаза 2).
- Course lifecycle, native scheduling и диспетчеризация уроков (фаза 3).
- HTML UI, сценарии, coding labs и исполнение пользовательского кода (фаза 4).
- Полный набор из 24 structural/workflow и 24 педагогических кейсов, model judges и Promptfoo release workflow (фаза 5).
- Tracelet, LangGraph, собственный agent loop, внешний evaluation worker.

## Функциональные требования и приёмка

- **FND-1 — совместимость состояния:** чтение v1/v2 сохраняет route и evidence; миграция оставляет backup. Patch обновляет только переданные поля; пропущенные массивы не очищаются. Устаревшая revision отклоняется без изменения файлов.
- **FND-2 — безопасное хранение:** абсолютный/обходной путь, symlink или junction, ведущие за workspace, отклоняются с `OUTSIDE_WORKSPACE`. Одновременные процессы не теряют обновления. После прерывания транзакции recovery приводит state и журнал к единому зафиксированному результату; один transaction ID не применяется повторно.
- **FND-3 — выбор workspace:** явный `--workspace PATH` сохраняет эффект при запуске из другого cwd; старые установки без флага продолжают использовать cwd fallback.
- **FND-4 — надёжная оценка:** неверный ответ и ошибка записи не потребляют карточку. Успешная assessment фиксирует attempt, evidence, state и receipt. Retry с теми же данными возвращает тот же результат после restart; reuse ID с другим input конфликтует. Hinted success не считается unaided retrieval.
- **FND-5 — промпты:** каждый из шести prompt IDs загружается и имеет стабильный digest при LF/CRLF нормализации. Неизвестные обязательные inputs отклоняются; input не может добавить message/role. Generated references совпадают с catalog; отсутствующие поля урока считаются нарушением контракта, короткий административный ответ не обязан иметь структуру урока.
- **FND-6 — диаграммы/transport:** валидные semantic nodes/edges создают детерминированную диаграмму; duplicate IDs и неизвестные endpoints дают validation error. Labels экранируются как текст и не внедряют HTML/директивы Mermaid. Legacy diagram input и JSON-RPC protocol negotiation сохраняют совместимость; stdout содержит только JSON-RPC.
- **FND-7 — capture:** event/result валидируются версионированной схемой. Повтор `eventId` не создаёт дубликат. Неизвестные данные (например, token usage) остаются отсутствующими; скрытые рассуждения, answer keys и grading criteria не попадают в public capture. Ошибка outbox видна как diagnostic, не отменяет committed assessment и допускает recovery capture по receipt.
- **FND-8 — автономность:** без evaluation tools базовые MCP операции продолжают работать. Ошибки, malformed inputs и recovery diagnostics не маскируются как успешная операция.

## Общие ограничения

- Node.js `>=20`; ES modules и `node:test`.
- Существующие MCP tool names и schema v1/v2 совместимы; новые вызовы могут передавать `expectedRevision` и `attemptId`.
- stdout зарезервирован для JSON-RPC; логи и diagnostics не печатаются туда.
- Приватные answer keys/criteria не входят в public response и public capture.
- Все обязательные проверки структурных контрактов должны пройти; skip/error не засчитываются как pass.

## Готовность фазы

Фаза принимается, когда FND-1…FND-8 подтверждены автоматизированными проверками, существующий `npm run verify` проходит, prompt build check не обнаруживает drift, а поведение проверено на Node 20 и актуальном LTS. До получения результатов эти пункты являются критериями, не заявлением об уже выполненной реализации.
