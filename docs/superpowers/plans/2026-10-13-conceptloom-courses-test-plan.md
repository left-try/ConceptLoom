# ConceptLoom Courses — план тестирования фазы 3

Связанные контракты: [спецификация Courses](../specs/2026-10-13-conceptloom-courses.md), [план реализации C1–C5](2026-10-12-conceptloom-courses.md), [Foundation test plan](2026-10-12-conceptloom-foundation-test-plan.md), [Knowledge implementation plan](2026-10-12-conceptloom-knowledge.md). Перед исполнением сверить этот gate с финальными тестовыми контрактами фазы 2; их текущий draft находится в отдельном Knowledge worktree.

Этот документ перечисляет автоматизированные тесты всей фазы. Suites собраны в одну команду `npm run test:courses`, чтобы после реализации C1–C5 прогнать фазу целиком. Полная регрессия выполняется отдельной командой `npm run verify`.

## Метод SDD/TDD

Для каждого CRS-критерия выбрать конкретный наблюдаемый инвариант. Сначала добавить минимальный тест, убедиться в ожидаемом RED из-за отсутствующей функции/проверки, затем реализовать минимальный GREEN. После этого запустить полный файл задачи и соседние регрессии. Ошибка тестовой среды не считается RED. Фикстуры локальные, синтетические и детерминированные; tests не обращаются к сети, LLM, реальному календарю или внешним scheduler.

Fault-injection точки должны моделировать сбой процесса/host boundary, а не только бросать ошибку до операции. Проверки host-native tool/UI и реальных расписаний ручные и записываются отдельно от автоматизированного PASS.

## Матрица доказательств

| Требование | Критические проверки | Уровень / приоритет | Целевая команда |
|---|---|---|---|
| CRS-1–2 Course/profile state, revisions, lifecycle | restart in a fresh Node process; concurrent updates with one winning revision; self-report/preferences retain their basis; prior profile goals survive patch; generic patch cannot set lifecycle/approval/evidence; two courses keep independent progression | unit + storage integration / P0 | `test/courses.test.mjs` |
| CRS-3–4 research, source binding, roadmap readiness | receipt matches imported resource/hash; metadata and syllabus role cannot approve teaching; partial/conflicting coverage stays visible; missing hash/locator blocks lesson; prerequisite cycle/missing node/duplicate UID; every taught concept has a teaching binding | contract + integration / P0 | `test/course-research.test.mjs`, `test/roadmap.test.mjs` |
| CRS-5–6 consent, projections, edits | exact roadmap digest; stale consent rejected; schedule and roadmap need separate consent; cadence/timezone changes invalidate consent; projection hash conflict leaves course unchanged; pause/resume retains progression | integration / P0 | `test/course-approval.test.mjs` |
| CRS-7 capability and native scheduling | observed capability report; timezone/workspace/receipt validation; one active scheduler across hosts; unsupported host fallback; missed run no-op; unknown publication requires reconciliation; replay reuses binding | unit + adapter contract / P0 | `test/host-scheduling.test.mjs` |
| CRS-8–9 dispatch, idempotency, capsule | two-host concurrent claim; replay returns same receipt; 15-minute lease recovery; awaiting learner blocks next lesson; paused/completed is no-op; missing evidence prevents completion; capsule limit preserves IDs/next action | concurrency + persistence / P0 | `test/course-dispatch.test.mjs` |
| CRS-10 prompts and transport | diagnosis separates preferences from knowledge evidence; source research states access honestly; lesson/resume contracts hold; course MCP tools register without replacing legacy names and reject malformed inputs; stdio output remains valid JSON-RPC | contract + integration / P0 | `test/course-prompts.test.mjs`, `test/course-tools.test.mjs`, `test/course-stdio.test.mjs` |
| Full user path | create/research/roadmap/consent/schedule receipt/lesson publication/replay/evidence/completion work together | end-to-end / P0 | `test/course-e2e.test.mjs` |
| Whole phase | All listed phase suites in one run; full existing regression separately | regression / P0 | `npm run test:courses`; then `npm run verify` |

## Фикстуры

- **Profiles/courses:** два курса на одном learner profile; mixed observations с basis `self-report`, `assessment`, `preference`; stale/current revisions; serialization round-trip после нового процесса.
- **Sources/research:** синтетические source manifests/receipts с разным coverage; version A/B с различными hashes; locator на точный hash; syllabus-only и teaching-material cases; конфликтующие receipts.
- **Roadmaps:** валидная последовательность из нескольких lessons/concepts, missing prerequisites, duplicate IDs, цикл, один недоступный teaching source, адаптация из более длинного syllabus.
- **Consent/projections:** фиксированные canonical digests, разные roadmaps с одинаковым заголовком, разные schedule cadence/timezone, ручной текст вне generated markers, изменённые и повреждённые markers.
- **Dispatch/scheduling:** два host adapters, fake clock, lease expiry, process restart на каждом external boundary, native receipts confirmed/unconfirmed, `publication-unknown`, завершённый/paused course.
- **Capsules:** обычный и предельный размер, до 5 due reviews, длинные источники, обязательные current step/course/lesson IDs, prompt digest и source locators.

Не включать в fixtures реальные полные книги/курсы или персональные данные. Все dates/timezone transitions управляются fake clock; тесты не ждут реального scheduler.

## Обязательные негативные и fault-injection сценарии

1. Неверный hash source manifest/receipt или устаревший locator блокирует roadmap readiness; существующий course и старые данные остаются неизменными.
2. Цикл prerequisites, неизвестный concept/source UID или некорректный consent digest блокирует соответствующий переход без побочных записей.
3. Пересогласованный roadmap меняется после approval до native schedule bind; старый approval не активирует timer.
4. Сбой после записи publication intent, но до внешнего вызова; повтор того же run безопасен.
5. Сбой после фактического создания host chat, но до сохранения receipt; состояние становится `publication-unknown`, автоматический повтор не создаёт второй чат.
6. Два процесса/host одновременно claim или publish один lesson; существует не более одной подтверждённой публикации и одна активная scheduler binding.
7. Неподдержанный timezone, DST/local-time edge, invalid cadence или отсутствующий durable workspace отклоняется с actionable diagnostics.
8. Manual projection edit, malformed generated markers, traversal path и symlink escape не приводят к перезаписи или выходу за workspace.
9. Capsule превышает лимит: mandatory resume context остаётся целым, избыток заменяется ссылками/diagnostics.
10. Старый/повторный run после pause/completion или missed schedule не перескакивает к следующему уроку и не меняет progression.

## Порядок выполнения

1. До реализации добавить и просмотреть все C1–C5 suites и общий end-to-end сценарий.
2. Выполнить фазовую реализацию целиком; при локальной отладке разрешено запускать отдельный файл, но приемочное доказательство — полный `npm run test:courses`.
3. После зелёного фазового набора выполнить `npm run verify` для всех старых и новых тестов и prompt drift check.
4. Повторить автоматический gate на Node 20 и актуальном поддерживаемом LTS. Указать точные Node/OS версии, результаты и причину любого skip.

## Ручной host acceptance

Отдельно для Codex и Claude Code Desktop: создать короткий двухурочный курс, подтвердить research coverage, показать и явно одобрить roadmap, выпустить первый lesson chat, задать в нём вопрос, убедиться в продолжении того же урока, повторить scheduled run и проверить отсутствие дубля, проверить pause и missed-run behavior. Реальное расписание включать только как часть ручной проверки с отдельным явным согласием пользователя.

Для ChatGPT/cloud добавить проверку устойчивого доступа к одному workspace между свежими scheduled chats. Если durable access или scheduler receipt недоступны, записать integration gap и проверить fallback-инструкцию; automated mock не заменяет такое подтверждение.

## Критерии завершения

- CRS-1…CRS-10 имеют ссылки на проходящие тесты; ни один P0 сценарий не пропущен.
- `npm run test:courses`, `npm run verify`, prompt drift check и целевые Foundation/Knowledge регрессии проходят.
- В fault-injection сценариях нет потерянных consent/evidence, двойных публикаций, неявного retry неизвестной операции или тихого пропуска урока.
- Все ручные host результаты содержат host/version, фактические возможности, workspace scope и receipt evidence. Непроверенный host не объявляется готовым.
