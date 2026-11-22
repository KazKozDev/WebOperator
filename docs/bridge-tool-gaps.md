# Bridge → MCP: чего агенту не хватает

Составлено по живому коду (`core/src`, `weboperator-bridge`) и по пробам сокета
`/tmp/weboperator-bridge.sock` (framed JSON: 4-byte LE length + `{id,type,payload,timeoutMs}`).

Сейчас наружу выставлено 10 MCP-тулов. Внутри расширения при этом уже лежит больше
(`select`, `wait`, `upload_attachment`, `read_downloaded_file`, `list_tabs/open_tab/switch_tab/close_tabs`,
`cookies` через CDP, clipboard, `browser.image`, `tasks.*`, `snapshot.maxNodes/allElements/refPrefix`),
но это не маршрутизируется через `executeBridgeRequest` (`core/src/background/service-worker.ts:661`).

Правило для всех пунктов: новый `case` в `executeBridgeRequest` + `bridgePayloadToToolCall`
(если действие идёт в content script) + тул в `weboperator-bridge/mcp-server.js` с полной схемой
(`additionalProperties: false`, но все поля объявлены) + прокидка `tabId`/`ref` (в `executeToolByName`
из `bridge.js` аргументы сейчас теряются — см. баги).

Формат payload/returns ниже — как есть, его я вызываю напрямую по сокету.

---

## P0 — без этого работа стоит

### 1. `browser.eval` → MCP `browser_eval`

```jsonc
// payload
{ "expression": "document.querySelectorAll('article').length", "returnByValue": true,
  "awaitPromise": true, "timeoutMs": 10000, "tabId": 123, "frameId": 0 }
// returns
{ "ok": true, "type": "number", "value": 12 }
{ "ok": false, "exception": { "text": "SyntaxError: ...", "url": "...", "line": 1, "column": 9 } }
```

Реализация: `chrome.debugger` уже поднят в `core/src/background/cdp-actions.ts` (attach `'1.3'`, строка 35,
`sendCommand` через хелпер ~строка 772). Нужен один generic: attach → `Runtime.enable` → `Runtime.evaluate
{expression, returnByValue, awaitPromise, userGesture: true, timeout}` → detach.
Если `chrome.debugger` недоступен (открыт DevTools), вернуть внятную ошибку, не падать.

Зачем: читать `innerText` поддерева, атрибуты (`href`, `data-*`), значения вне 400-узлового снапшота,
`window.__NUXT__`/`__NEXT_DATA__`, `document.scrollHeight`, содержимое open shadow root.
Без него любой разбор идёт через a11y-дерево с потерей данных.

### 2. `browser.wait` → MCP `browser_wait`

```jsonc
// payload
{ "until": "element|text|url|network_idle|load|timeout",
  "ref": "@e12", "selector": ".results", "text": "Отправить", "urlPattern": "/search",
  "timeoutMs": 15000, "pollMs": 150, "visible": true }
// returns
{ "ok": true, "elapsedMs": 1840, "matched": "@e12" }
{ "ok": false, "elapsedMs": 15000, "error": "text 'Отправить' did not appear" }
```

Реализация: `doWait` уже есть (`core/src/lib/actions.ts:373`), но покрывает только `none|load|element|network_idle`,
без `selector`/`text`/`url`, и `network_idle` — фикция (см. баги). Расширить: `selector` (querySelector),
`text` (подстрока в `innerText`, опционально `visible`), `until: "url"` — на стороне background через
`chrome.tabs`, `network_idle` — реальный (CDP `Network` в полёте < 2 запросов 500 мс, иначе фолбэк на тишину DOM).

Зачем: сейчас любое ожидание — это `sleep` фиксированной длины, отсюда «клик в пустоту» и флаки на SPA.

### 3. Tabs API → MCP `tabs_list`, `tabs_current`, `tabs_open`, `tabs_activate`, `tabs_close`

```jsonc
tabs_list     {}                                  → { "tabs": [ { "tabId": 123, "windowId": 1, "url": "...",
                                                      "title": "...", "active": true, "status": "complete",
                                                      "groupId": -1, "frameCount": 1 } ] }
tabs_current  {}                                  → { "tabId": 123 }
tabs_open     { "url": "https://…", "active": true, "windowId": 1 } → { "tabId": 124 }
tabs_activate { "tabId": 123 }                    → { "ok": true }
tabs_close    { "tabIds": [123, 124] }            → { "closed": [123] , "errors": [] }
```

Реализация: `chrome.tabs.query/get/create/update/remove`; хелперы уже есть —
`activeTabFromPayload` (`service-worker.ts:808`) и обход вкладок в `agent-loop.ts:2619`.

Зачем: `tabId` принимают все тулы, но узнать его негде. Действия агента `list_tabs/open_tab/switch_tab/close_tabs`
объявлены (`lib/types.ts:191`), но через мост недоступны.

### 4. `tasks.*` наружу → MCP `agent_task_start`, `agent_task_list`, `agent_task_get`, `agent_task_stop`, `agent_task_confirm`

```jsonc
agent_task_start { "goal": "…", "startUrl": "https://…", "autoConfirm": false, "wait": false, "tabId": 123 }
   → { "taskId": "uuid", "tabId": 124, "status": "running" }
agent_task_list  { "limit": 20 }                  → { "tasks": [ { "id", "goal", "status", "tabId", "updatedAt" } ] }
agent_task_get   { "id": "uuid" }                 → { "id", "status", "plan", "steps": [ … ] }
agent_task_stop  { "id": "uuid" }                 → { "ok": true, "status": "stopped" }
```

Реализация: типы уже обслуживаются — `service-worker.ts:734-760` (`tasks.list/get/start/pause/resume/stop/confirm/wait`),
проверено по сокету: `tasks.list` вернул 50 задач с `tabId`/`modelUsed`/`plan`, `tasks.get` — 15 шагов.

Зачем: `weboperator_execute_goal` блокирующий, без id, без cancel, без промежуточных шагов. Долгую задачу
нельзя ни прервать, ни посмотреть, где встала. Нужно ещё, чтобы `execute_goal` отдавал `taskId` при `wait: false`.

---

## P1 — сильно расширяет применимость

### 5. Сеть: `network_list`, `network_get`, `network_clear`

```jsonc
network_list  { "sinceMs": 60000, "urlPattern": "/api/", "type": "xhr", "limit": 100 }
   → { "requests": [ { "requestId": "1234.5", "url": "…", "method": "GET", "status": 200,
                       "mimeType": "application/json", "ts": 1792658841755, "size": 8123 } ] }
network_get   { "requestId": "1234.5" }           → { "body": "…", "base64": false, "mimeType": "application/json" }
network_clear {}                                  → { "ok": true }
```

Реализация: CDP `Network.enable` при attach, кольцевой буфер в service worker (500 запросов, тело ≤ 5 МБ,
хранить только `xhr`/`fetch`/`document`). Тело — `Network.getResponseBody`.

Зачем: на X, LinkedIn, Wildberries/Amazon и в маркетплейсах JSON-эндпоинт на порядок надёжнее и дешевле DOM-скрейпинга.
Сейчас остаётся только парсить DOM и надеяться.

### 6. Cookies / storage: `cookies_get`, `cookies_set`, `storage_get`, `storage_set`

```jsonc
cookies_get   { "domain": "x.com" }               → { "cookies": [ { "name", "value", "domain", "path", "expires", "httpOnly", "secure", "sameSite" } ] }
cookies_set   { "url": "https://x.com", "name": "auth_token", "value": "…", "path": "/", "secure": true } → { "ok": true }
storage_get   { "tabId": 123, "kind": "local|session", "keys": ["token"] } → { "items": { "token": "…" } }
storage_set   { "tabId": 123, "kind": "local", "items": { "k": "v" } }     → { "ok": true }
```

Реализация: `storage_*` — через content script (без новых прав). `cookies_*` — `chrome.cookies`,
для этого в `core/manifest.config.ts` нужно добавить permission `"cookies"` (сейчас его нет: есть
`activeTab, tabs, scripting, storage, sidePanel, alarms, debugger, downloads, nativeMessaging`).
Это единственный пункт спеки, который требует нового разрешения — если не хочется трогать манифест,
можно отдать только `storage_*` + `document.cookie` через eval.

Зачем: диагностика разлогинов, перенос сессии, проверка «почему страница пустая».

### 7. Консоль и ошибки: `console_list`

```jsonc
{ "sinceMs": 30000, "level": "error|warn|log|all", "limit": 200 }
→ { "entries": [ { "ts": 1792658841755, "level": "error", "text": "…", "url": "…", "line": 12 } ] }
```

Реализация: CDP `Runtime.enable` + `Log.enable`, буфер в service worker (те же attach/detach, что в п. 1).

Зачем: при поломке страницы я вижу пустой снапшот и не вижу причину.

### 8. Загрузка файлов: `browser_upload_file`

```jsonc
{ "ref": "@e42", "path": "/Users/artemk/Desktop/promoREPO/assets/preview-novelgenerator.png" }
→ { "ok": true, "name": "preview-novelgenerator.png", "size": 182344 }
```

Реализация: `cdpUploadAttachment` уже написан (`core/src/background/cdp-actions.ts:106`, `DOM.setFileInputFiles`),
действие `upload_attachment` есть в `lib/types.ts:194`. Нужен только bridge-тип и валидация пути
(абсолютный, существует, ≤ 40 МБ).

Зачем: приложить референс в ChatGPT/DALL-E — это мой основной пайплайн для исторических кадров.

### 9. Скачивание: `browser_download`, `downloads_list`, `downloads_read`

```jsonc
browser_download { "url": "https://…/paper.pdf", "filename": "paper.pdf", "saveAs": false }
   → { "downloadId": 12, "path": "/Users/artemk/Downloads/paper.pdf", "bytes": 812344, "state": "complete" }
downloads_list   { "sinceMs": 600000, "limit": 20 } → { "items": [ { "id", "filename", "url", "bytes", "state", "mime" } ] }
downloads_read   { "downloadId": 12, "maxBytes": 20000000 } → { "kind": "text|base64", "content": "…", "truncated": false }
```

Реализация: `chrome.downloads` уже в манифесте и используется в `lib/attachment-staging.ts` и `lib/file-reader.ts`
(там же чтение последнего скачанного файла).

Зачем: PDF со страницы/статьи без ручного Safari-скрипта; сейчас скачивание только вручную.

---

## P2 — качество жизни, но регулярно мешает

### 10. Снапшот: прокинуть параметры и отдать метаданные

```jsonc
{ "tabId": 123, "allElements": true, "maxNodes": 800, "refPrefix": "f2",
  "roles": ["button","link","textbox"], "query": "цена", "text": true, "diff": true,
  "includeImages": true, "minImageArea": 5000, "shadow": true }
→ { "url", "title", "viewport", "nodes": [ { "ref", "role", "name", "bbox", "inViewport",
      "href", "value", "state", "text", "src", "frameId" } ],
    "textSnippets", "domHash", "truncated": true, "total": 1342, "frameCount": 3 }
```

Что нужно внутри `lib/a11y.ts`:
- прокинуть `allElements` / `maxNodes` / `refPrefix` (уже реализованы: строки 17-19, 49-66; сейчас MCP их не передаёт);
- `roles`/`query` — фильтр на этапе сборки, чтобы не жечь токены;
- `text: true` — `el.innerText` (обрезка 200 символов) в узле;
- `diff: true` — сравнение с предыдущим снапшотом вкладки: `added`, `removed`, `changed`;
- `includeImages: true` — добавить в выдачу `img[src]` (см. фикс №2 в багах) с `src`, `naturalWidth/Height`;
- `shadow: true` — обход open shadow root;
- `truncated`/`total` — явный признак обрезки (сейчас просто молча упирается в `maxNodes = 400`);
- `frameId` в узле — сейчас refs фреймов кодируются префиксом, но обратно это не видно.

### 11. `browser_extract` со схемой

```jsonc
{ "instruction": "список товаров", "selector": ".card", "ref": "@e30",
  "schema": { "type": "array", "items": { "type": "object",
              "properties": { "title": {"type":"string"}, "price": {"type":"number"} },
              "required": ["title","price"] } } }
→ { "ok": true, "data": [ … ] }   // провалидировано по schema
```

Сейчас `extract` возвращает свободный текст, и я парсю его вручную — на каждом шаге риск.

### 12. Чтение страницы: `browser_read`

```jsonc
{ "ref": "@e30", "selector": "article", "format": "markdown|text", "maxChars": 40000 }
→ { "content": "# Заголовок\n\n…", "chars": 12844, "truncated": false }
```

Нужно для статей, arXiv-абстрактов, документации: markdown сохраняет заголовки и ссылки.

### 13. Скриншоты: `browser_screenshot` расширить

```jsonc
{ "ref": "@e12", "fullPage": true, "format": "png|jpeg", "quality": 80, "saveTo": "/path/file.png" }
→ { "dataUrl": "data:image/png;base64,…", "path": "/path/file.png", "w": 1393, "h": 4211 }
```

Сейчас — только viewport, всегда jpeg q80, через `captureVisibleTab` (`service-worker.ts:673`).
Нужны: full-page и по элементу через CDP `Page.captureScreenshot {clip, captureBeyondViewport}`,
плюс запись в файл (иначе я таскаю base64 через контекст).

### 14. Мышь: hover / double / right / drag

```jsonc
browser_click { "ref": "@e12", "button": "left|right|middle", "clickCount": 2, "modifiers": "Shift" }
browser_hover { "ref": "@e12" }                          → { "ok": true }
browser_drag  { "from": "@e12", "to": "@e30", "steps": 12 } → { "ok": true }
```

Реализация: content script `mouseover/mouseenter` + CDP `Input.dispatchMouseEvent` (уже используется
в `lib/captcha-solver.ts`). Нужно для меню на hover, drag-and-drop, контекстных меню.

### 15. `scrollIntoView` перед действием

`snapshot` отдаёт `bbox` и `inViewport`, а `allElements: true` добавляет узлы вне вьюпорта — клик/ввод
по такому ref, скорее всего, промахивается. В `doClick`/`doType` (`lib/actions.ts:38,39`) нужно
`el.scrollIntoView({block:'center'})` + проверка видимости, и ошибка `Element not visible after scroll`,
а не молчаливый промах.

### 16. Clipboard: `clipboard_read`, `clipboard_write`

```jsonc
clipboard_write { "text": "…" } → { "ok": true }
clipboard_read  {}              → { "text": "…" }
```

Код уже есть: `writeClipboardInPage` / `readClipboardInPage` (`cdp-actions.ts:327,342`).
Нужно, чтобы вставлять многострочные промпты/код не посимвольно через `type`.

---

## Баги, которые надо починить по пути

1. **`index` не совпадает с refs.** `bridgePayloadToToolCall` (`service-worker.ts:835`) превращает
   `index: 12` в `@12`, а рефы в снапшоте — `@e12`. Клик по `index` молча бьёт в никуда. Фикс: `` `@e${index}` ``.
2. **`browser.image` не видит контентные картинки.** Селектор снапшота (`a11y.ts:25-27`) не содержит `img`,
   поэтому у обычных `<img>` refs вообще нет; `role:"img"` — это `<svg role="img">` иконки, внутри которых
   `imageForRef` нечего найти. Проверено: 101 img-ref на HF, все `No image at @eN`; через ссылку-обёртку
   (`@e1`) читается нормально. Фикс: опция `includeImages` (п. 10) + в ошибке подсказывать родительский ref.
3. **`executeToolByName` (`bridge.js:596`) выбрасывает аргументы** — вызывается `requestExtension('browser.snapshot', {})`,
   т.е. HTTP-фолбэк `/v1/tools/call` теряет `ref`, `tabId`, `amountPx`. Через сокет те же вызовы проходят.
   Фикс: прокидывать `args` как есть.
4. **`wait until=network_idle` — фикция.** `actions.ts:393-396`: `await sleep(min(ms, 2000))`. Нужен реальный
   счётчик в полёте (п. 2), иначе он врёт и агенту, и мне.
5. **`snapshot` молча обрезается** на `maxNodes = 400` без признака в ответе — добавить `truncated`/`total`.
6. **`tasks.list` жёстко 50 записей** без параметра `limit`.
7. **`execute_goal` не возвращает `taskId`** и не умеет `wait: false` — связать с п. 4.

---

## Чего не нужно (чтобы не тратить силы)

- Прокси/геолокация/подмена User-Agent — не мой сценарий.
- Полноценный `webRequest`-перехват с блокировкой — хватит read-only `Network` из п. 5.
- Отдельный тул на каждую капчу — `browser_solve_captcha` уже покрывает.
- Свой планировщик/LLM внутри — `execute_goal` остаётся, мне нужны примитивы.

---

## Приёмка

Каждый новый тип я проверяю тем же клиентом по сокету на живой вкладке, без пересборки Hermes:

- `type: "browser.eval"` → `1+1` ⇒ `{ok:true, value:2}`;
- `browser.wait` → ждём появление `@eN` на SPA с реальным таймингом < таймаута;
- `tabs.list` → совпадает с тем, что видно в браузере (по url/title);
- `network.list` → после загрузки x.com отдаёт ≥ 1 xhr с json-телом;
- `browser.image` по ref обёртки → `bytes > 0`;
- `tasks.start` + `tasks.stop` → задача создана, шаги видны, цикл остановлен;
- каждый пункт — отдельная строка pass/fail в отчёте.

Сборка у тебя: `cd core && npm run check` (typecheck + lint + test + knip + build) и переустановка распакованного
расширения; мост перезапускается сам, Hermes перезапуска не требует.

---

## Приложение: сводка того, что именно добавить

Правило маппинга по умолчанию: имя MCP-тула = `type.replace('.', '_')`;
префикс `mcp__weboperator__` добавляет клиент. Исключение: `agent_task_*` — явные
алиасы `tasks.*` из таблицы ниже, а не результат этой замены.

Новая фича = `case` в `executeBridgeRequest` + `bridgePayloadToToolCall`, если действие
уходит в content script, + схема `TOOLS` и маршрутизация `handleToolCall` в MCP.
После реализации P0 общая схема и таблица алиасов находятся в
`weboperator-bridge/tools.js`; их используют `mcp-server.js` и HTTP-мост `bridge.js`.
Номера строк выше относятся к исходному срезу кода и могут сдвигаться.

### 29 новых тулов

| # | P | MCP tool | bridge type |
|---|---|---|---|
| 1 | P0 | `browser_eval` | `browser.eval` |
| 2 | P0 | `browser_wait` | `browser.wait` |
| 3 | P0 | `tabs_list` | `tabs.list` |
| 4 | P0 | `tabs_current` | `tabs.current` |
| 5 | P0 | `tabs_open` | `tabs.open` |
| 6 | P0 | `tabs_activate` | `tabs.activate` |
| 7 | P0 | `tabs_close` | `tabs.close` |
| 8 | P0 | `agent_task_start` | `tasks.start` (в расширении готово) |
| 9 | P0 | `agent_task_list` | `tasks.list` |
| 10 | P0 | `agent_task_get` | `tasks.get` |
| 11 | P0 | `agent_task_stop` | `tasks.stop` |
| 12 | P0 | `agent_task_confirm` | `tasks.confirm` |
| 13 | P1 | `network_list` | `network.list` |
| 14 | P1 | `network_get` | `network.get` |
| 15 | P1 | `network_clear` | `network.clear` |
| 16 | P1 | `browser_upload_file` | `browser.upload_file` |
| 17 | P1 | `browser_download` | `browser.download` |
| 18 | P1 | `downloads_list` | `downloads.list` |
| 19 | P1 | `downloads_read` | `downloads.read` |
| 20 | P1 | `console_list` | `console.list` |
| 21 | P1 | `cookies_get` | `cookies.get` |
| 22 | P1 | `cookies_set` | `cookies.set` |
| 23 | P1 | `storage_get` | `storage.get` |
| 24 | P1 | `storage_set` | `storage.set` |
| 25 | P2 | `browser_read` | `browser.read` |
| 26 | P2 | `browser_hover` | `browser.hover` |
| 27 | P2 | `browser_drag` | `browser.drag` |
| 28 | P2 | `clipboard_read` | `clipboard.read` |
| 29 | P2 | `clipboard_write` | `clipboard.write` |

Расширения существующих тулов (новых имён не нужно): `browser_snapshot` +`allElements/maxNodes/roles/query/text/diff/includeImages/shadow`,
`browser_extract` +`schema`, `browser_click` +`button/clickCount/modifiers`,
`browser_screenshot` +`ref/fullPage/format/saveTo`, `browser_scroll` +`to: "element"/ref/block`,
`weboperator_execute_goal` +`wait: false` → `taskId`.

### Дополнение к п. 4: `agent_task_confirm`

```jsonc
agent_task_confirm { "id": "uuid", "approve": true } → { "ok": true, "status": "running" }
```

Нужен, когда `tasks.start` идёт с `autoConfirm: false` и агент останавливается на шаге, требующем
подтверждения (оплата, отправка формы). Без него такие задачи ждут решения до подтверждения или остановки.
Это обязательный инструмент для задач с `autoConfirm: false`, но вызывать его нужно
только при `status: "awaiting_confirm"`. `approve: false` отклоняет действие и
возвращает `{ok: true, status: "failed"}` согласно текущему циклу агента.
`allow` остаётся совместимым алиасом `approve`; противоречивые значения — ошибка.
Само `awaiting_confirm` сохраняется в истории, чтобы его видел `agent_task_get`.

### Дополнение к п. 15 и `browser_scroll`

```jsonc
browser_scroll { "to": "element", "ref": "@e30", "block": "center" } → { "ok": true, "scrollY": 1840 }
```

`block` принимает `start|center|end|nearest`, по умолчанию `center`.
Плюс в `doClick`/`doType` — авто-`scrollIntoView` с проверкой видимости после прокрутки.
Если элемент остался скрытым или вне viewport, вернуть ошибку
`Element not visible after scroll`; действие не выполнять. MCP должен передавать эту
ошибку клиенту, а не отвечать успешным `Clicked`/`Typed`.

### Минимальный набор, если не хочется сразу 29

Шесть тулов дают ~80% эффекта: **`browser_eval`, `browser_wait`, `tabs_list`, `tabs_current`,
`network_list`, `browser_upload_file`**. `tasks.*` — следующими, они уже готовы внутри расширения.

### Размер контекста

39 тулов со схемами в промпте — многовато. Hermes откладывает их в deferred-каталог
(`tool_search` / `tool_describe`), так что контекст не забьётся. Если всё же хочется компактнее,
объединяй парные: `cookies_get/set` → `cookies {action: "get"|"set"}`,
`storage_get/set` → `storage`, `downloads_list/read` → `downloads`,
`tabs_*` → один `tabs {action: "list"|"current"|"open"|"activate"|"close"}`. Тогда 29 → 22.

