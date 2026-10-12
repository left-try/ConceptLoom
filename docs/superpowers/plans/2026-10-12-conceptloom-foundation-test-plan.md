# ConceptLoom Foundation — план тестирования

Связанная спека: [Foundation](../specs/2026-10-12-conceptloom-foundation.md). Реализационная декомпозиция и точные интерфейсы: [Foundation implementation plan](2026-10-12-conceptloom-foundation.md).

## Метод

Используем SDD для фиксации проверяемых требований до кода и TDD внутри каждой задачи:

1. Для одного критерия из спеки добавить минимальный тест с наблюдаемым результатом.
2. Запустить тест и увидеть ожидаемое падение именно из-за отсутствующего поведения.
3. Написать минимальную реализацию, чтобы пройти тест.
4. Повторить тест, затем набор текущей задачи; после завершения фазы выполнить полный gate.
5. Рефакторить только после зелёного цикла, сохраняя зелёные проверки.

Фикстуры должны быть локальными и детерминированными. Внешняя модель, сеть, scheduler и evaluation provider не нужны для базового gate. Platform-specific symlink/junction сценарий получает явный skip только когда ОС/права действительно не поддерживают fixture; skip не считается pass для требования безопасности и фиксируется отдельно.

## Матрица проверок

| Область / требования | Тесты и ключевые утверждения | Команда этапа |
|---|---|---|
| Workspace, path containment, миграция (FND-1–3) | `explicit workspace survives different cwd`; `patch preserves omitted arrays`; `stale revision changes nothing`; `two processes serialize`; `recovers interrupted transaction`; `rejects junction escape`; `v1/v2 migration retains evidence`. Проверять неизменность файлов при конфликте, одну выигравшую revision, backup и однократное применение transaction ID. | `node --test test/storage.test.mjs test/workspace.test.mjs test/progress.test.mjs test/setup.test.mjs` |
| Checkpoint commit/evidence (FND-4) | `invalid answer does not consume token`; `failed commit keeps card usable`; `same attempt returns receipt after restart`; `same attempt with different input conflicts`; `parallel same token records once`; `hinted success is not unaided retrieval`. Проверять отсутствие answer/rationale в public card и согласованность receipt/state/evidence. | `node --test test/checkpoints.test.mjs test/assessment-service.test.mjs test/progress.test.mjs` |
| OPF prompts/build (FND-5) | `six catalog prompts load`; `missing input fails`; `input cannot add messages`; `CRLF keeps digest`; `reference drift is detected`. Дополнительно проверять контракт урока и допустимость короткого admin response; валидировать parser против официальных OPF fixtures. | `node --test test/prompts.test.mjs`; `node scripts/build-prompts.mjs --check` |
| Semantic diagrams/registry/stdio (FND-6) | `semantic nodes have consistent styles`; `labels remain escaped text`; `missing endpoint fails`; `duplicate node ID fails`; `legacy source still works`; `MCP serves valid JSON only`. Утвердить стабильность вывода и отсутствие постороннего stdout. | `node --test test/diagrams.test.mjs test/bridge.test.mjs` |
| Capture/schema/outbox (FND-7–8) | `duplicate event recorded once`; `private fields excluded`; `unknown usage stays absent`; `outbox failure does not undo committed assessment`; `recover capture from receipt`; schema rejects malformed critical fields; MCP без capture/eval tools работает. | `node --test test/capture.test.mjs` |
| Полная регрессия | Все существующие и новые тесты; syntax checks всех JS entry points; generated prompt references актуальны. | `npm run verify`; `node scripts/build-prompts.mjs --check` |

## Обязательные негативные сценарии

- Изменение с устаревшей revision, повтор ID с иным содержимым, malformed JSON/event, неизвестный node endpoint.
- Сбой записи после первого rename и ошибка outbox после успешного state commit.
- Путь с пробелами/кириллицей, traversal и junction/symlink за workspace.
- Prompt input с role delimiter, Mermaid label с HTML, кавычками, backticks и символами, похожими на синтаксис Mermaid.
- Повтор assessment/capture после перезапуска процесса.
- Успешное упражнение с hint не должно повышать unaided retrieval streak.

## Решение о приёмке

- Все критические инварианты FND-1…FND-8 проходят; нет скрытых ошибок, незаявленных skips или незавершённых test cases.
- `npm run verify` и prompt drift check завершаются с кодом 0 на Node 20 и актуальном LTS.
- Для каждого skip записаны имя теста, причина и платформа; platform-specific недоступность не превращается в успешный результат.
- Автоматический gate не заменяет ручную проверку host-specific установки Codex/Claude/OpenCode/DeepSeek. Такие проверки отмечаются отдельно и не блокируют детерминированную локальную Foundation-приёмку, пока не заявляется соответствующая интеграционная гарантия.

## Порядок исполнения

Выполнять последовательно F1 → F2 → F3 → F4 → F5: F2 и F3 оба потребляют storage из F1; F4 должен создать registry, который расширяет F5. На каждом подэтапе сначала закрывается его RED/GREEN цикл; затем проверяются его соседи, перечисленные в команде этапа. В конце выполняются полный gate и проверка generated outputs. Этот документ задаёт тестовые доказательства; подробный перечень файлов, интерфейсов и коммитных единиц остаётся в implementation plan.
