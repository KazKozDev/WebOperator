# Bridge → MCP: приёмка P0

Дата: 2026-10-22. Реализован этап P0 из [bridge-tool-gaps.md](bridge-tool-gaps.md).
Пункты P1/P2 остаются открытыми.

## Изменения

- Добавлены `browser_eval`, `browser_wait`, `tabs_list/current/open/activate/close`,
  `agent_task_start/list/get/stop/confirm` (всего 22 MCP-инструмента).
- Схемы stdio MCP и HTTP MCP объединены в `weboperator-bridge/tools.js`, файл включён в npm-пакет.
- HTTP `/v1/tools/call` передаёт аргументы расширению полностью: в том числе `tabId`, `ref`, `amountPx`.
- Числовой `index` преобразуется в `@eN`. HTTP `clear:false` сохраняет режим append.
- `tasks.list` принимает `limit` (1–1000; по умолчанию 50).
- `weboperator_execute_goal` поддерживает `wait:false`; ответ содержит `taskId`.
  Блокирующий ответ теперь JSON с `answer`, статусом и `taskId`.
- `tasks.wait` распознаёт `stopped` как конечное состояние.
- Ожидания элемента/текста/URL/load проверяют условие и сообщают о таймауте.
  Ожидание в content script больше не ограничено прежними 10 секундами.
- `network_idle` отслеживает CDP Network и ждёт <2 запросов в течение 500 мс.
  При недоступном debugger используется DOM quiet с `source:dom` и предупреждением.
- Eval поддерживает async Promise, исключения, ограничение времени и освобождение debugger.
  Ненулевой Chrome `frameId` сопоставляется с main-world контекстом по временному DOM-маркеру.

## Проверки

`npm run check --prefix core`: **PASS** — typecheck, lint, 51 файл / 348 тестов,
knip, shellcheck, production build. Сборка выдаёт предупреждение о больших чанках.

`node scripts/mcp-smoke.mjs`: **PASS** — публикация 22 инструментов,
HTTP fallback, параметры новых инструментов, `wait:false`, отсутствие повторного
выполнения через HTTP при ошибке уже подключённого сокета.

`node scripts/bridge-smoke.mjs`: **PASS** — HTTP/socket auth, discovery, SSE.

Распакованное расширение `core/dist` перезагружено в Brave Nightly через страницу
расширений; native host автоматически переподключился. Живая приёмка:
`node scripts/bridge-p0-live.mjs` (локальная тестовая страница и native socket).

| Проверка | Результат |
| --- | --- |
| tabs.open/list: новая вкладка и URL | PASS |
| browser.wait load | PASS |
| browser.eval: 1+1 = 2 | PASS |
| browser.eval: исключение JS | PASS |
| browser.eval: await Promise | PASS |
| browser.eval: таймаут бесконечного Promise и последующий eval | PASS |
| browser.eval: дочерний iframe | PASS |
| browser.wait: появление элемента SPA после задержки | PASS |
| browser.wait: text, URL, отрицательный таймаут | PASS |
| browser.wait: два реальных fetch-запроса и network idle | PASS |
| index → @eN: клик и проверка изменения DOM | PASS |
| HTTP: tabId, ref и amountPx проходят до расширения | PASS |
| scroll to=element, auto-scroll click, отказ click/type для скрытых элементов, HTTP 400 | PASS |
| tabs.activate/current | PASS |
| tasks.list limit | PASS |
| tasks.start/get/stop: id, steps и фактический status=stopped | PASS |
| tasks.confirm: ошибка при отсутствии ожидающего подтверждения | PASS |
| tabs.close: закрытие тестовой вкладки | PASS |

Тестовые вкладки закрыты, исходная активная вкладка восстановлена.
Тестовые остановленные задачи остаются в истории.

## Границы проверки

- Подтверждение реального опасного действия через `tasks.confirm allow:true` не выполнялось.
- Остановка кооперативная: уже выполняющийся вызов модели/действие может закончиться
  до проверки флага остановки. `tasks.stop` возвращает `stopRequested`, фактический
  `stopped` нужно читать через `tasks.get`/`tasks.wait`.
- CDP Network видит события с момента подключения. Запросы, начавшиеся до подключения,
  могут не попасть в счётчик; постоянный сетевой буфер из P1 здесь не реализован.
- Eval iframe проверен на same-origin iframe. Cross-process iframe, контекст которого
  недоступен debugger текущей вкладки, возвращает явную ошибку.
- Сетевое ожидание проверено на локальных fetch; X и P1 network_list/get/clear не проверялись.
- Процесс MCP, уже запущенный клиентом до обновления, может требовать переподключения
  для перечитывания списка инструментов. Hermes не перезапускался.

## Дополнения из приложения

- `agent_task_confirm` принимает `{id, approve}` и возвращает `{ok, status}`;
  прежний `allow` сохранён как алиас. Положительное и отрицательное решения,
  некорректные входы и совместимость проверены unit-тестами.
- Состояние `awaiting_confirm` сохраняется в БД перед ожиданием решения;
  `tasks.get` больше не скрывает этот барьер за устаревшим `running`.
- `browser_scroll {to:"element", ref, block}` доходит до content script и возвращает
  `ok` и `scrollY`. Прокрутка к элементу и авто-прокрутка click проверены в живом браузере.
- `doClick`/`doType` проверяют видимость после scrollIntoView, возвращают
  `Element not visible after scroll` и не выполняют действие на скрытом элементе.
  Ошибка передаётся клиенту как MCP `isError` или HTTP 400.
- Сводка 29 новых инструментов и расширений существующих сохранена в приложении;
  уточнено исключение из правила маппинга для `agent_task_*` → `tasks.*`.
- P1/P2 и необязательная консолидация 29→22 не реализовывались на этом этапе.

После дополнений: полный `check` — PASS, оба smoke-набора — PASS,
живая приёмка — 18/18 PASS. Расширение в Brave обновлено повторно.
