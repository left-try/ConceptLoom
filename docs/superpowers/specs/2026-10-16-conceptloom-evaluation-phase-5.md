# ConceptLoom Evaluation — спецификация фазы 5

Дата: 16 октября 2026. Статус: контракт для планирования и реализации фазы 5.

Основание: [дизайн платформы](2026-10-12-conceptloom-learning-platform-design.md), [Foundation](2026-10-12-conceptloom-foundation.md), [Knowledge](2026-10-13-conceptloom-knowledge.md), [Courses](2026-10-13-conceptloom-courses.md), [Practice/UI](2026-10-14-conceptloom-practice.md), [план фазы](../plans/2026-10-16-conceptloom-evaluation-phase-5.md), [план тестов](../plans/2026-10-16-conceptloom-evaluation-test-plan.md).

## Цель и результат

Фаза добавляет воспроизводимую проверку корректности контрактов, provenance источников, учебных материалов и сохранённых evaluation events. Разработчик может локально прогнать детерминированные проверки и replay, получить отчёт с версиями входов и явным решением release gate. Платные model-judge запуски остаются отдельной явно настраиваемой операцией.

Результат фазы не доказывает фактическое долговременное усвоение материала учащимся. Structural assertions не заявляют семантическое следование ответа источнику. Успех evaluation не меняет learner mastery.

## Входит в фазу

1. Дополнение structural/workflow набора до 24 стабильных cases и версионированные deterministic assertions для OPF, состояния/checkpoints, OKF, source/citation, course/dispatch и practice/capture.
2. Локальная Promptfoo-интеграция в изолированном `evals/` package с locked dependencies и recorded-output/offline режимом. Отсутствие eval package или его runtime не мешает MCP core.
3. Педагогический набор из 24 RU/EN cases с уровнями beginner/experienced, шестью типами ситуаций, источниками с hash/locators и отдельным holdout split.
4. Версионированная рубрика по измерениям `mechanism`, `example`, `level`, `grounding`, `limitations`, `practice`; фиксация human labels и отчёт о согласии judges с проверенными labels.
5. Replay явно выбранных событий по точным версиям исходных артефактов и генерация отчёта, показывающего полноту набора, ошибки, пропуски, критические нарушения и статус gate.
6. CI для deterministic checks и recorded evaluations без credentials, внешних providers и платных вызовов.

## Вне области

- Автоматический постоянный сбор/перехват пользовательских разговоров, tracing SDK/worker и интеграция Tracelet.
- Утверждение, что оценки LLM или benchmark scores измеряют фактическое усвоение. Для такого утверждения нужен отдельный протокол с learner outcomes.
- Любые изменения learner mastery на основании evaluator result.
- Автоматическое скачивание источников, выбор provider/model от имени пользователя, платные вызовы по умолчанию или хранение секретов в dataset.
- Подмена отсутствующих, ошибочных или пропущенных результатов успешными; скрытое исключение holdout; вывод semantic grounding из проверки синтаксиса citation.

## Требования и критерии приёмки

- **EVL-1 — полнота структурного набора.** Ровно 24 стабильных case ID покрывают шесть перечисленных областей. Для каждого case указаны входы, ожидаемый статус/диагностика и ссылка на исходный subsystem test. Неподдержанная возможность имеет явный `skipped` и блокирует требуемый release gate.
- **EVL-2 — provenance citations.** Citation засчитывается только при разрешении к известному source UID, локатору и совпадающему content hash. Markdown label или квадратные скобки сами по себе не являются evidence. Проверка идентичности не утверждает semantic entailment.
- **EVL-3 — offline безопасность.** Recorded/offline запуск читает только заданные outputs и локальные fixtures; не вызывает generation provider или model judge даже при наличии credentials. Отсутствующий recorded output, provider error или ошибка eval-инструмента видны как ошибка, не pass.
- **EVL-4 — педагогическая рубрика.** Все 24 case распределены по RU/EN, beginner/experienced и шести ситуациям; 12 calibration и 12 holdout сбалансированы по языку и уровню. Обязательные измерения mechanism/example/level/grounding имеют минимум 2 из 3. Critical failures (ложная атрибуция, утечка ответа/критериев) проваливают case независимо от среднего. Labels со статусом `pending-review` не используются как подтверждённая калибровка.
- **EVL-5 — явный запуск judge.** Judge run требует явно заданные provider/configuration, положительный budget и лимит cases с отдельным подтверждением paid run. Неизвестная стоимость не разрешает запуск. Ошибка judge не считается нулевым score или pass. Calibration и holdout результаты выводятся раздельно.
- **EVL-6 — версионированный replay.** Результат связан с event ID, evaluator ID/version, dataset/prompt digest и source hashes, если применимо. Повтор идентичного завершённого результата идемпотентен; другой revision требует нового результата. Неполный/повреждённый JSONL диагностируется без потери остальных валидных строк. Недоступный исходный revision даёт inconclusive/error, не реконструирует контекст.
- **EVL-7 — отчёт и gate.** Отчёт содержит ожидаемые и фактические case IDs, pass/fail/error/skipped, critical failures, версии evaluator/dataset/prompt/sources, разделённые calibration/holdout показатели, человеческие labels, ручные host evidence gaps и итоговый gate. Missing/error/skipped required cases блокируют pass. Отчёт не меняет mastery.
- **EVL-8 — совместимость и CI.** Core продолжает работать без Promptfoo и eval dependencies. Обычный CI запускает deterministic suites и locked recorded eval без сети, credentials и paid jobs. Платный judge config отсутствует из обязательного CI.

## Ограничения

- Core остаётся Node.js `>=20`, ES modules и `node:test`; Promptfoo располагается в отдельном package с собственным lockfile/runtime floor.
- Детерминированные fixtures синтетические и проверяются офлайн. Платные модели запускаются только по явной команде и с контролем бюджета.
- Event capture сохраняет только разрешённые фактические поля; не добавлять в публичный capture expected answer, rubric, скрытое рассуждение или приватный grading material.
- Результаты не раскрываются в public vault и не становятся учебным evidence автоматически.

## Готовность фазы

EVL-1…EVL-8 покрыты автоматизированными тестами из [плана тестов](../plans/2026-10-16-conceptloom-evaluation-test-plan.md). Все обязательные deterministic cases и recorded regression проходят; `npm run verify` проходит. Отчёт корректно блокирует gate на missing/error/skipped required cases. Judge calibration публикуется только после человеческой проверки labels; holdout не используется для настройки. Непроверенные host, semantic grounding и learner outcomes отмечены как непроверенные.
