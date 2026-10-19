# ConceptLoom Evaluation — план реализации фазы 5

Цель: реализовать требования EVL-1…EVL-8 из [спецификации фазы](../specs/2026-10-16-conceptloom-evaluation-phase-5.md), используя существующие capture-event/eval-result contracts и ранний черновик [плана Evaluation](2026-10-12-conceptloom-evaluation.md).

## Архитектура

Core хранит локальные события и результаты через существующий контракт; отдельный eval package отвечает за Promptfoo. Deterministic evaluators и replay не требуют Promptfoo. Recorded regression не вызывает сеть. Paid model judges запускаются отдельной командой с явным config, budget и case limit. Отчёт строится из версионированных результатов и не пишет в learner progression.

## Этапы

### E1 — Structural/workflow cases и assertions

**Файлы:** `evals/datasets/contracts.json`, `evals/assertions/{contracts,citations,concealment,workflow}.mjs`, `test/eval-assertions.test.mjs`; дополнить `test/fixtures/contracts/` и `test/fixtures/contracts/ledger.json`.

1. Зафиксировать полный ledger из 24 stable IDs: по 4 case на OPF, state/checkpoint, OKF/roundtrip, source/citation, course/dispatch, UI/practice/capture. Привязать к subsystem tests.
2. Реализовать детерминированные assertions для contract invariants, citation resolution, concealment и workflow order/consent/idempotency. Версионировать evaluator IDs.
3. Проверить exact source UID/locator/hash, не выдавая это за semantic entailment. Невозможные к проверке сценарии пометить skipped с diagnostics.
4. Добавить единый release-invariant helper, который требует ожидаемый набор IDs и блокирует gate на fail/error/skipped required case.

**Результат:** полный ledger и JSON/JSONL result для каждого case с диагностикой и версией evaluator.

### E2 — Promptfoo recorded/offline package

**Файлы:** `evals/package.json`, lockfile, `evals/promptfooconfig.yaml`, `evals/providers/recorded.mjs`, `evals/providers/opf.mjs`, `scripts/eval-offline.mjs`, `test/eval-offline.test.mjs`; добавить root scripts.

1. Изолировать eval dependencies в `evals/`; закрепить проверенную Promptfoo версию и её runtime floor без изменения core engine floor.
2. Реализовать recorded provider только по case ID с отказом на отсутствующий output; запретить network fallback. OPF renderer сериализует messages и сохраняет prompt digest.
3. Оформить offline runner, который сравнивает recorded outputs и применяет deterministic assertions. Подтвердить отсутствие provider/judge вызовов даже при доступных credentials.
4. Добавить `npm run eval:offline` и команду recorded Promptfoo; отсутствие `evals/node_modules` или package не ломает обычный MCP.

**Результат:** воспроизводимый локальный Promptfoo report и тестируемая гарантия нулевых внешних вызовов в offline режиме.

### E3 — Teaching dataset, labels и явный judge runner

**Файлы:** `evals/datasets/teaching.jsonl`, `evals/datasets/splits.json`, `evals/rubrics/teaching.yaml`, `evals/labels/teaching.jsonl`, `evals/promptfoo-model.yaml`, `scripts/eval-model.mjs`, `test/eval-rubrics.test.mjs`, `docs/evaluation.md`.

1. Подготовить 24 случая: RU/EN × beginner/experienced × шесть ситуаций (обычный урок, неопределённое утверждение, конфликт источников, частичный доступ, resume, интерактивная практика). Приложить фиксированные source excerpts, locators и hashes; не копировать защищённые полные материалы.
2. Разделить 12 calibration и 12 holdout, сбалансировать язык и уровень, валидировать отсутствие пересечения IDs. Human labels требуют supporting excerpts и статуса review; draft labels остаются pending-review.
3. Реализовать scoring: шесть измерений 0–3; mechanism/example/level/grounding не ниже 2; critical failure даёт fail вне зависимости от среднего.
4. Сделать judge runner с обязательными provider/config, `--allow-paid`, положительными `--budget-usd` и `--max-cases`. Не запускать при неизвестной цене; сохранять judge errors как errors. Калибровочные и holdout отчёты не смешивать.
5. Зафиксировать процедуру ручной проверки labels и disagreement report; не заявлять калибровку до завершения human review.

**Результат:** валидируемый pedagogical benchmark и контролируемый, явно вызываемый judge путь; автоматические проверки datasets/rubric не требуют provider.

### E4 — Replay, отчёты, release gate и CI

**Файлы:** `scripts/eval-replay.mjs`, `scripts/eval-report.mjs`, `test/eval-replay.test.mjs`, `.github/workflows/evaluation.yml`; при необходимости минимальные расширения `src/evaluation/capture.mjs`, обновить `README.md`, `docs/ru/README.md`, `CHANGELOG.md`.

1. Реализовать replay по явному списку event IDs с точным lookup immutable artifacts. Идентичность результата включает event/evaluator version, source hashes и prompt/dataset digest.
2. Обрабатывать JSONL построчно: malformed строки дают диагностику/quarantine, валидные события остаются доступны; повтор completed той же версии идемпотентен.
3. Строить Markdown/JSON report с completeness, errors/skipped, critical failures, версионностью, host evidence gaps и отдельными calibration/holdout секциями.
4. Включить в gate полноту required IDs; missing/error/skipped блокируют PASS. Подтвердить, что replay/report не изменяют mastery и не восстанавливают отсутствующий source context.
5. Настроить CI: core проверки на поддерживаемом Node и recorded Promptfoo на закреплённом eval runtime. Не запускать paid judges и не запрашивать секреты.

**Результат:** локально воспроизводимый release report и CI без платных/external calls.

## Зависимости

E1 → E2 (offline runner потребляет assertions); E1 и E3 → E4 (report/gate потребляют оба набора результатов). E3 dataset/rubric validation можно делать параллельно с E1/E2, но release gate завершается после E1–E4.

## Definition of Done

- EVL-1…EVL-8 выполнены и связаны с тестами из [плана тестов](2026-10-16-conceptloom-evaluation-test-plan.md).
- 24 structural и 24 pedagogical cases доступны по стабильным IDs; нет незаявленных пропусков.
- Offline/recorded evaluation проверен без сети и credentials; отсутствующий output не проходит.
- Judge path требует явной конфигурации/бюджета; holdout остаётся изолированным; labels не review не выдаются за калибровку.
- Replay/отчёт сохраняют версии, честно учитывают missing/error/skipped и не меняют learner mastery.
- `npm run verify`, новые evaluation suites и locked recorded eval проходят. Результаты ручного host acceptance и настоящего judge calibration указаны только если фактически выполнены.
