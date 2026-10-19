# ConceptLoom Evaluation — план тестов фазы 5

Связанные документы: [спецификация](../specs/2026-10-16-conceptloom-evaluation-phase-5.md), [план реализации](2026-10-16-conceptloom-evaluation-phase-5.md), [ранний план Evaluation](2026-10-12-conceptloom-evaluation.md), [Foundation test plan](2026-10-12-conceptloom-foundation-test-plan.md), [Courses test plan](2026-10-13-conceptloom-courses-test-plan.md), [Practice test plan](2026-10-14-conceptloom-practice-test-plan.md).

План задаёт обязательные доказательства EVL-1…EVL-8. Конкретные suite names можно уточнить при реализации, сохранив инварианты и приоритеты.

## Стратегия

- Детерминированные проверки используют `node:test`, синтетические fixtures и временные workspaces; не требуют сети, LLM, внешнего host или платных credentials.
- Offline tests подменяют/spy generation provider и judge, чтобы подтвердить ноль вызовов.
- Recorded Promptfoo suite запускается только с закреплённой eval зависимостью и фиксированными outputs.
- Judge calibration — отдельная ручно подтверждаемая проверка; непроведённый judge run не мешает unit suite, но не даёт заявить calibration PASS.
- Не добавлять и не запускать тесты, проверяющие mastery через evaluation results: контракт прямо запрещает такое изменение.

## Матрица проверок

| Требование | Критические кейсы | Приоритет/уровень | Целевой suite |
|---|---|---|---|
| EVL-1 Structural coverage | 24 уникальных ID; все шесть доменов представлены; у каждого есть ожидание и ссылка на исходный тест; required skipped блокирует gate | P0 / dataset + unit | `test/eval-assertions.test.mjs` |
| EVL-2 Citation provenance | валидный source/locator/hash проходит; label без evidence не проходит; неверный UID/locator/hash диагностируется; citation syntax не делает semantic claim | P0 / unit | `test/eval-assertions.test.mjs` |
| EVL-3 Offline safety | recorded run не вызывает provider/judge; отсутствующий output/provider error даёт error; credentials не переключают режим; runtime eval package optional для core | P0 / unit + subprocess | `test/eval-offline.test.mjs` |
| EVL-4 Rubric and dataset | 24 cases, RU/EN × level × situation coverage; split 12/12 сбалансирован и disjoint; labels имеют evidence/status; pending-review исключён из calibration; обязательное измерение <2 и critical failure проваливают результат | P0 / unit | `test/eval-rubrics.test.mjs` |
| EVL-5 Judge guard | без allow-paid/config/budget/max-cases запуск запрещён; неизвестная стоимость блокирует; judge error не pass; holdout результат не используется для калибровки | P0 / unit + mocked runner | `test/eval-rubrics.test.mjs` |
| EVL-6 Replay identity | одинаковый completed replay идемпотентен; версия источника/prompt/evaluator меняет identity; нет source revision → inconclusive/error; malformed JSONL не теряет валидные строки; ошибка может retry явно | P0 / unit + storage | `test/eval-replay.test.mjs` |
| EVL-7 Report/gate | missing/error/skipped required ID блокирует PASS; complete required results дают ожидаемый gate; отчёт отображает версии, critical failures, host gaps и pending labels; report не меняет learner state | P0 / unit + integration | `test/eval-replay.test.mjs` |
| EVL-8 Compatibility/CI | чистая установка core без eval package работает; offline root command делегирует корректно; CI не требует credentials и не содержит paid judge job | P0 / integration + static | `test/eval-offline.test.mjs`, `test/bridge.test.mjs`, workflow validation |
| Cross-phase regression | Foundation/Knowledge/Courses/Practice suites и MCP JSON-RPC остаются совместимыми; capture privacy не расширена | P0 / regression | `npm run verify`, соответствующие suites |

## Фикстуры

- Structural ledger: 24 case IDs, 4 на каждый домен; сохранить первые 8 существующих cases, расширить оставшиеся 16 без переопределения ID.
- Citations: реестр synthetic source UID, content hash, locator и отрывки; cases с label без provenance, неверным hash и отсутствующим source revision.
- Pedagogy: по одному набору на RU/EN и beginner/experienced для шести сценариев; фиксированные excerpts/hashes без приватных данных и полных защищённых материалов.
- Labels: human label status (`pending-review`/`reviewed`), supporting excerpt/reference, reviewer metadata без личных данных; fixture с неполной/несогласованной label.
- Replay: валидные, повторные, конфликтующие revision и повреждённые JSONL строки; результаты pass/fail/error/skipped; metadata absent fixture.
- Offline: recorded outputs, missing case output, fake provider/judge с call counters и configured credentials fixture.

## Обязательные fault-injection сценарии

1. Удалить один обязательный case из результата: отчёт блокирует release gate и перечисляет пропущенный ID.
2. Подменить citation на валидно выглядящий Markdown label с неверным hash: provenance assertion проваливается.
3. Запустить offline runner при установленной API credential переменной: generation/judge call counters остаются нулевыми.
4. Удалить recorded output: case получает error, не пустой output и не pass.
5. Перенести case между calibration и holdout либо продублировать ID: dataset validation блокирует запуск.
6. Оставить labels в pending-review: calibration report не заявляет human-validated agreement.
7. Поставить обязательный rubric dimension в 1/3 при высоком общем score: case fail; добавить critical failure: case fail независимо от score.
8. Имитировать неизвестную стоимость, превышение budget и judge exception: платный запуск останавливается/отклоняется, результат не помечается pass.
9. Изменить source hash после сохранения результата: replay не переиспользует старый результат и показывает отсутствие точного контекста.
10. Повредить одну строку JSONL между корректными: диагностика указывает line, обе корректные записи остаются обрабатываемыми.
11. Выпустить два identical replay: один логический результат. Изменить evaluator version: новый результат без перезаписи прошлого.
12. Сгенерировать report при ошибках: snapshot явно показывает missing/error/skipped, critical failures, версии и host evidence gaps.
13. Сравнить learner progress до и после replay/report: состояние идентично.
14. Запустить MCP core без eval install/config: базовые tools и JSON-RPC framing работают.

## Порядок и команды

1. При реализации каждого требования сначала добавить адресный test и подтвердить, что он ловит отсутствующий/ошибочный контракт, затем добавить минимальную реализацию.
2. Запускать конкретный evaluation suite после изменения соответствующего E1–E4 этапа, затем соседние phase regressions.
3. На завершении: `npm run verify`, `npm run eval:offline`, `npm --prefix evals run eval:recorded` и `npm run eval:validate-dataset` (добавить scripts, если выбранные имена будут отличаться — сохранить семантику).
4. Paid judge run не является тестом обязательного CI. Его запуск, стоимость и подтверждённые labels фиксируются отдельно только при явной конфигурации.

## Критерии завершения

- Все P0 assertions проходят; все 24 structural cases и 24 pedagogical cases перечислены и валидированы.
- Offline режим доказан как zero-provider/zero-judge-call; recorded output отсутствует — значит ошибка.
- Calibration/holdout изолированы, review status labels прозрачен, критические нарушения не усредняются.
- Replay и release report честно блокируют неполный набор и сохраняют исходные артефакты/learner state.
- Полная regression проверка успешна; внешние host, paid judge и learner outcomes отмечены только по фактическим наблюдениям.
