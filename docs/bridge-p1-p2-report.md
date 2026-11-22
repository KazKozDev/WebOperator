# Bridge → MCP: приёмка P1/P2

Дата: 2026-10-22. Реализованы все инструменты P1 и P2 из [bridge-tool-gaps.md](bridge-tool-gaps.md).
Общее количество MCP-инструментов выросло до 39.

## Реализованные инструменты

- **Сеть (P1)**: `network_list`, `network_get`, `network_clear`. Кольцевой буфер CDP Network в service worker, общий сеанс с `browser.eval`.
- **Консоль (P1)**: `console_list`. Сбор ошибок, предупреждений и логов через CDP `Log` и `Runtime.consoleAPICalled`.
- **Cookies и Storage (P1)**: `cookies_get`, `cookies_set` (CDP Network, поддержка `HttpOnly`, `secure`, `domain`, `path`), `storage_get`, `storage_set` (`localStorage` и `sessionStorage` через content script).
- **Загрузка и скачивание файлов (P1)**:
  - `browser_upload_file`: проверка пути (абсолютный, файл существует, размер ≤ 40 МиБ), выбор файла через CDP `DOM.setFileInputFiles`.
  - `browser_download`: запуск скачивания через `chrome.downloads`, возврат `downloadId`, пути, размера и статуса. При появлении системного диалога Save возвращает `requiresUserAction: true` и статус `in_progress`.
  - `downloads_list`: список скачиваний с фильтрацией по времени и лимитом.
  - `downloads_read`: безопасное чтение завершённого файла с диска через native host (с проверкой размера, лимитом `maxBytes` и признаком `truncated`).
- **Расширенный снимок DOM (P2)**: `browser_snapshot` с поддержкой `maxNodes`, `total`, `truncated`, `roles`, `query`, `text` (содержимое узла), `diff` (сравнение с предыдущим снимком: `added`, `removed`, `changed`), `includeImages` (узлы `img` с `src`, `naturalWidth`/`naturalHeight`), `shadow` (обход open Shadow DOM) и прямая адресация через `browser.image`.
- **Чтение контента (P2)**: `browser_read` (форматы `markdown` с заголовками и ссылками или чистый `text`, обрезка по `maxChars` с флагом `truncated`).
- **Скриншоты (P2)**: `browser_screenshot` с поддержкой `fullPage`, обрезки по элементу (`ref`), форматов `png`/`jpeg`, качества и записи напрямую в файл (`saveTo`).
- **Мышь (P2)**: `browser_click` (`button`, `clickCount`, `modifiers`), `browser_hover`, `browser_drag` (`from`, `to`, `steps`).
- **Буфер обмена (P2)**: `clipboard_read`, `clipboard_write`. На macOS реализован через системные `pbpaste`/`pbcopy` в native host (без запроса разрешений у сайтов).
- **Структурированное извлечение (P2)**: `browser_extract` со схемой JSON Schema и валидацией (`validateSchema`).

## Проверки

1. `cd core && npm run check`: **PASS** — typecheck, eslint, 54 файла / 357 тестов, knip (0 dead code), shellcheck, production build.
2. `node scripts/mcp-smoke.mjs`: **PASS** — все 39 инструментов зарегистрированы и валидируются.
3. `node scripts/bridge-smoke.mjs`: **PASS** — аутентификация, сокет, SSE, HTTP fallback.
4. `node --test scripts/bridge-files.test.mjs`: **PASS** — модульные тесты native file boundaries, upload, download truncation, screenshot write, clipboard roundtrip.
5. Живая приёмка P0 (`node scripts/bridge-p0-live.mjs`): **18/18 PASS**.
6. Живая приёмка P1/P2 (`node scripts/bridge-p1-p2-live.mjs`): **14/14 PASS**.

| Проверка | Результат |
| --- | --- |
| network_clear/list/get, persistent capture shared with eval | PASS |
| console_list errors and warnings | PASS |
| cookies_set/get via CDP including HttpOnly | PASS |
| storage_get/set local and session | PASS |
| snapshot maxNodes/total/truncated, filters, text, stable diff refs | PASS |
| snapshot includeImages + browser.image direct and parent refs | PASS |
| snapshot shadow root and actionable shadow ref | PASS |
| browser_read Markdown and truncation | PASS |
| browser_upload_file validates path and selects local bytes | PASS |
| browser_download + downloads_list/read actual native file | PASS |
| browser_screenshot fullPage/ref/jpeg/saveTo | PASS |
| browser_click double/right/modifiers + hover + drag | PASS |
| clipboard_read/write round trip and restore | PASS |
| browser_extract schema with configured model and validation | PASS |

Все тестовые вкладки и временные файлы убраны.
