# MCP tools

The shared catalogue in `weboperator-bridge/tools.js` contains 45 tools and is used by both stdio MCP and the bridge's HTTP `/mcp` endpoint.

| Area | Tools |
| --- | --- |
| Browser observation | `browser_snapshot`, `browser_read`, `browser_extract`, `browser_screenshot`, `browser_image`, `browser_eval`, `browser_wait` |
| Browser actions | `browser_navigate`, `browser_click`, `browser_type`, `browser_press`, `browser_scroll`, `browser_hover`, `browser_drag`, `browser_select_option`, `browser_handle_dialog`, `browser_solve_captcha` |
| Files | `browser_upload_file`, `browser_download`, `downloads_list`, `downloads_read` |
| Tabs | `tabs_list`, `tabs_current`, `tabs_open`, `tabs_activate`, `tabs_close` |
| Agent tasks | `weboperator_execute_goal`, `agent_task_start`, `agent_task_list`, `agent_task_get`, `agent_task_stop`, `agent_task_confirm`, `agent_task_pause`, `agent_task_resume`, `agent_task_wait` |
| Network and console | `network_list`, `network_get`, `network_clear`, `console_list` |
| Cookies and storage | `cookies_get`, `cookies_set`, `storage_get`, `storage_set` |
| Clipboard | `clipboard_read`, `clipboard_write` |

## New primitives

- `browser_image {tabId?, ref}` returns an MCP image block with PNG/JPEG/WebP/GIF bytes, followed by text metadata. Use `browser_snapshot {includeImages:true}` to obtain image refs. Other image formats return an explicit error.
- `browser_select_option {tabId?, ref?, selector?, value}` selects a native HTML `<select>` option by value or label and dispatches `input` and `change`. Supply a ref or CSS selector. Hidden and disabled controls, disabled options and missing choices fail without changing the value.
- `browser_handle_dialog {tabId?, action, promptText?}` observes or handles page JavaScript dialogs. Call `action:"status"` before the action that opens an alert, confirm or prompt; status returns `{observing:true, dialog:null|{type,message,url,defaultPrompt}}`. Then explicitly `accept` or `dismiss`. `promptText` is accepted only when accepting a prompt. No dialog is automatically accepted. Native file pickers and browser security prompts are outside this tool.
- `agent_task_pause {id}` requests a cooperative pause at an agent checkpoint; an in-flight action or model request may finish first. The response includes `pauseRequested`; this is not proof the task has already reached the checkpoint.
- `agent_task_resume {id}` clears that pause request. It does not restart a finished task.
- `agent_task_wait {id, timeoutMs?}` waits up to 120 seconds by default (maximum 600 seconds). It returns the current task on timeout and does not cancel it. Use `agent_task_stop` to request cancellation.

## Build and verification

`./scripts/check.sh` runs fixtures, security/native-file/MCP smoke checks, unit tests, lint, typecheck, dead-code analysis, shellcheck and the extension build. Native clipboard roundtrip tests run only on macOS.

For an installed native host with the rebuilt extension loaded:

```bash
node scripts/bridge-tools-live.mjs
```

This opt-in acceptance check opens a local fixture tab, exercises the live MCP catalogue, select, image, alert/confirm/prompt and task controls, then closes its tab and requests task cancellation. It can leave a stopped test task in history.

The extension and native bridge must be updated together. Reconnect existing MCP clients to refresh `tools/list`. Publishing a GitHub change does not itself publish an npm release.
