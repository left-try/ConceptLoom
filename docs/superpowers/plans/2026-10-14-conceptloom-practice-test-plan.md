# ConceptLoom Practice/UI — план тестирования фазы 4

Связанные контракты: [спецификация Practice/UI](../specs/2026-10-14-conceptloom-practice.md), [план реализации Practice/UI](2026-10-12-conceptloom-practice.md), [Foundation test plan](2026-10-12-conceptloom-foundation-test-plan.md), [Courses test plan](2026-10-13-conceptloom-courses-test-plan.md).

Документ определяет доказательства автоматизированного gate всей фазы. Конкретные suite-команды и имена тестов можно уточнить при реализации, сохраняя требования PRC-1…PRC-7 и приоритеты ниже.

## Метод SDD/TDD

Для каждого требования сначала добавить минимальный тест на наблюдаемый инвариант и подтвердить RED от отсутствующей функции/проверки, затем реализовать минимальный GREEN. Ошибка окружения не считается RED. После локального suite запустить соседнюю регрессию; по завершении фазы выполнить новый полный phase suite и `npm run verify`.

Тесты по умолчанию используют `node:test`, временные workspace, fake clock/process и поддельный executor. Не обращаться к сети, LLM, реальному host UI или scheduler. Реальный MCP Apps render и Docker security smoke отмечаются отдельно; их отсутствие нельзя засчитать как PASS по mock.

## Матрица доказательств

| Требование | Критические проверки | Уровень / приоритет | Предлагаемый suite |
|---|---|---|---|
| PRC-1 public/private split | rubric marker отсутствует в public get, tool result, resource, HTML bytes и starter export; приватные критерии доступны только assessment path; public exercise revision неизменяема/проверяема | schema + unit / P0 | `test/practice.test.mjs`, `test/ui-data.test.mjs`, `test/ui-resources.test.mjs`, `test/coding-executor.test.mjs` |
| PRC-2 attempt integrity | первый submit сохраняет exact response/hash; restart читает ту же receipt; replay того же ID/input не дублирует; повтор ID с отличающимся input — conflict/no overwrite; неверная revision отклонена; двойной submit не создает двойной evidence | unit + storage/concurrency / P0 | `test/practice.test.mjs` |
| PRC-3 assessment/evidence | submit не повышает mastery; verdict ссылается на настоящую попытку, exercise revision и rubric version; failure после commit сохраняет response; run evidence не маскируется как reasoning evidence; feedback только после durable write | integration / P0 | `test/practice.test.mjs`, `test/course-e2e.test.mjs` (регрессия) |
| PRC-4 UI/fallback | hostile label выводится текстом; public/private scan; resource URI и metadata соответствуют регистрации; неизвестный URI даёт ошибку; граф соседей ограничен; отключённый UI возвращает text fallback; ошибка сборки/открытия не теряет данные | unit + adapter contract / P0 | `test/ui-resources.test.mjs`, `test/ui-data.test.mjs` |
| PRC-5 scenarios/simulations | одинаковый seed воспроизводит сценарий; запрещённый transition оставляет state прежним; trace различает одинаковый выбор с разным reasoning/order; export/import сохраняет UID/revision/seed; solution недоступен до assessment; UI/local/text передают эквивалентный grading input | unit + integration / P1 | `test/scenarios.test.mjs`, `test/course-e2e.test.mjs` (регрессия) |
| PRC-6 coding executor | unavailable не PASS; неверный digest/config отклонён до запуска; argv без shell и только trusted command; filename traversal/symlink escape блокируется; private tests не попадают в stage/mount; timeout убивает процесс; stdout/stderr cap и truncation видимы; failure сохраняет response; mocks проверяют no-network, readonly mounts, nonroot, CPU/memory/pids limits | unit + mocked process / P0 | `test/coding-executor.test.mjs` |
| PRC-6 real isolation | пример lab запускается с pinned image; сеть и host FS недоступны; readonly mounts соблюдаются; ресурсные пределы и timeout реально работают; private tests не наблюдаемы из guest | optional container integration / P0 для заявления coding execution support | ручной Docker smoke, отдельно от стандартного suite |
| PRC-7 bridge/compatibility | новые tools не затирают legacy names; valid JSON-RPC без шума в stdout; malformed params не меняют state; capability report валидируется; host без UI/executor всё ещё может получить и сохранить текстовую попытку | contract + integration / P0 | `test/practice.test.mjs`, `test/bridge.test.mjs`, `test/*stdio*.test.mjs` |
| Полный путь учащегося | открыть lesson graph → выполнить seeded scenario → отправить → перезапустить → получить ту же попытку и связанное feedback/evidence без дубля; при UI/executor unavailable путь через text fallback остаётся явным | end-to-end / P0 | `test/practice-e2e.test.mjs` (создать при реализации) |
| Полная регрессия | все новые suites, существующие регрессии и статические/prompt checks | regression / P0 | добавить `npm run test:practice`; затем `npm run verify` |

## Наборы фикстур

- **Упражнения:** scenario, simulation и coding; revisions r1/r2; публичная постановка и уникальные sentinel-строки в приватных критериях; варианты malformed schema и неизвестного поля.
- **Попытки:** одинаковый и конфликтующий `attemptId`; Unicode/пустой ответ; длинные артефакты; hint/confidence; trace с одинаковым выбором и разным порядком рассуждений; сериализация до/после нового процесса.
- **Граф/UI:** небольшой граф с известными source locators и ограниченно большой граф; метки `<script>`, HTML entities, bidi/Unicode; отсутствующие/внешние ссылки; fixture private marker для сканирования bundle/resource/export.
- **Сценарии:** валидные/невалидные действия, фиксированные seeds, ожидаемая последовательность событий, скрытый rubric marker и контрольный answer leak.
- **Executor:** поддельный backend для available/unavailable, stdout overflow, nonzero exit и timeout; filename `../`, абсолютный/drive path, symlink; команды с shell metacharacters; immutable digest fixture. Тесты не требуют установленного Docker.
- Не включать персональные данные, реальные пользовательские исходники или целиком скопированные платные курсы.

## Обязательные негативные и fault-injection сценарии

1. После фиксации ответа процесс завершается до feedback: повторный вызов возвращает сохранённую попытку, не оценивает её дважды и не теряет ответ.
2. Один `attemptId` конкурентно отправлен с одинаковым и разным input: ровно одна durable попытка; конфликтующая запись ничего не перезаписывает.
3. Exercise revision меняется между отображением и submit: stale submission отклоняется, исходная попытка и state остаются нетронутыми.
4. Private marker проходит через все public boundaries — tools, resource, generated HTML, локальный export и starter files; ни в одном результате marker не присутствует.
5. Source label содержит HTML/JS и path-like текст: UI показывает строку безопасно, не исполняет её и не читает путь.
6. MCP UI отсутствует/ресурс недоступен: пользователь получает пригодный fallback с явной передачей ответа, а не фиктивный receipt об оценке.
7. Повтор одного seed даёт то же случайное состояние; invalid action не продвигает сценарий и не удаляет предыдущее решение.
8. Executor недоступен, digest mutable/отсутствует, команда недоверенная или sandbox config не соответствует контракту: код не запускается и результат не маркируется успешным.
9. Timeout, слишком большой stdout/stderr, nonzero exit или failure между execution и persistence: лимиты соблюдаются, диагностика сохраняется, ответ учащегося остаётся доступен.
10. Filename traversal, абсолютный путь, symlink escape и попытка чтения private test из learner stage блокируются до старта процесса.
11. Ошибка capture/evaluation после durable save не откатывает ответ; legacy MCP tools и JSON-RPC framing остаются рабочими.

## Порядок выполнения

1. До реализации создать unit/contract suites P0 для public/private split, idempotency, revision mismatch, path containment и честного unavailable status.
2. По мере P1–P4 реализации запускать конкретный suite, затем соседние Foundation/Courses regressions.
3. Добавить end-to-end сценарий и `npm run test:practice`, включающий все phase suites без optional Docker зависимости.
4. Выполнить `npm run check`, `npm run test:practice` и `npm run verify`; записать точную версию Node и результаты.
5. Если Docker явно настроен, отдельно выполнить isolation smoke. Если host UI доступен, вручную проверить разные host targets и сохранить версию/наблюдаемые возможности. Не запускать сеть и host UI из автоматического suite.

## Ручной acceptance

Для каждого фактически доступного host проверить: открыть один и тот же публичный урок/граф; безопасно отобразить недоверенную label; пройти scenario и передать attempt; повторить submit; отключить UI и пройти допустимый text fallback. Зафиксировать host/version, UI capability, способ возврата ответа и реальные ограничения. Codex, Claude Code Desktop, ChatGPT и OpenCode — отдельные строки матрицы; результат одного хоста не переносится на остальные.

Для optional executor отдельно зафиксировать image digest, Docker/runtime version, запускаемую команду, network/filesystem/resource isolation и исходы timeout/output limit. При отсутствии настроенного backend отметить `unavailable`/не проверено; не подменять это PASS.

## Критерии завершения

- PRC-1…PRC-7 связаны с проходящими тестами; все P0 автоматические cases имеют evidence.
- Полные `npm run test:practice` и `npm run verify` проходят; phase additions не ломают contracts предшествующих фаз.
- Нет утечек private criteria, потерянных/дублированных attempts, оценки stale revision, escape из workspace или ложного pass при неисполненном коде.
- Ручной host acceptance и optional Docker smoke сообщают только реально проверенные возможности; пропуски явно отмечены как непроверенные.
