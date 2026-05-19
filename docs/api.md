# WebOperator Local Agent API

WebOperator exposes a local agent bridge through `weboperator-bridge/`.
The Chrome extension starts the bridge with Native Messaging, then agents can talk to the bridge either through a framed JSON Unix socket or through the compatibility HTTP API.

```text
Agent -> framed JSON socket -> WebOperator Native Messaging host -> Chrome extension -> active tab
```

## Run

Install the native host, reload the extension, then start the bridge:

```bash
cd weboperator-bridge
./install.sh
node bridge.js
```

By default the bridge listens on:

- framed JSON socket: `/tmp/weboperator-bridge.sock`
- compatibility HTTP API: `127.0.0.1:8765`

Environment variables:

- `WEBOPERATOR_BRIDGE_HOST`: bind host, default `127.0.0.1`
- `WEBOPERATOR_BRIDGE_PORT`: bind port, default `8765`
- `WEBOPERATOR_BRIDGE_LOG`: log file, default `/tmp/weboperator-bridge.log`
- `WEBOPERATOR_AGENT_SOCKET`: framed JSON socket path, default `/tmp/weboperator-bridge.sock`
- `WEBOPERATOR_API_TOKEN`: bearer token for `/v1/*`
- `WEBOPERATOR_ALLOW_UNAUTHENTICATED_BRIDGE=1`: explicit development-only bypass when no token is set

## Auth

Every HTTP `/v1/*` request must include one of:

```bash
Authorization: Bearer <token>
X-WebOperator-Token: <token>
```

Query-string tokens are not supported because URLs are commonly logged.
`GET /health` does not require auth and returns `authRequired`.
Socket requests must include `"token":"<token>"`.
If no token is configured, `/v1/*` and socket requests are rejected unless `WEBOPERATOR_ALLOW_UNAUTHENTICATED_BRIDGE=1` is set.

For a machine-readable contract, see `docs/openapi.yaml`.

## Framed JSON Socket

The primary agent protocol is 4-byte little-endian length-prefixed JSON over a Unix domain socket.
This mirrors Chrome Native Messaging framing, but it is for agent-to-bridge traffic.

Default socket:

```text
/tmp/weboperator-bridge.sock
```

Request:

```json
{
  "id": "req-1",
  "type": "browser.snapshot",
  "payload": {},
  "timeoutMs": 30000,
  "token": "optional-if-auth-enabled"
}
```

Response:

```json
{
  "id": "req-1",
  "result": {}
}
```

Error:

```json
{
  "id": "req-1",
  "error": "WebOperator extension is not connected to the bridge"
}
```

Events are pushed to connected socket clients:

```json
{
  "kind": "event",
  "event": {
    "kind": "task:update"
  }
}
```

Quick check:

```bash
node weboperator-bridge/agent-client.js '{"type":"bridge.health"}'
```

Socket request `type` values match the HTTP endpoint names:

- `bridge.health`
- `browser.snapshot`
- `browser.screenshot`
- `browser.navigate`
- `browser.click`
- `browser.type`
- `browser.press`
- `browser.scroll`
- `browser.extract`
- `tasks.list`
- `tasks.get`
- `tasks.start`
- `tasks.stop`
- `tasks.pause`
- `tasks.resume`
- `tasks.confirm`
- `tasks.wait`

## Compatibility HTTP API

The HTTP API remains available for tools that cannot speak framed JSON sockets.

## Response Shape

Successful JSON endpoints return the extension result directly.
Errors return:

```json
{
  "error": "Missing or invalid WebOperator API token"
}
```

Common status codes:

- `200`: success
- `400`: invalid JSON or malformed request
- `401`: missing or invalid API token
- `404`: unknown endpoint
- `500`: bridge or extension error

## Health

```http
GET /health
```

Example:

```json
{
  "ok": true,
  "bridge": "online",
  "extension": "online",
  "authRequired": true
}
```

## Browser Endpoints

```http
GET /v1/browser/snapshot
GET /v1/browser/screenshot
POST /v1/browser/navigate
POST /v1/browser/click
POST /v1/browser/type
POST /v1/browser/press
POST /v1/browser/scroll
POST /v1/browser/extract
```

Examples:

```bash
curl http://127.0.0.1:8765/v1/browser/snapshot \
  -H "Authorization: Bearer $WEBOPERATOR_API_TOKEN"

curl -X POST http://127.0.0.1:8765/v1/browser/navigate \
  -H "Authorization: Bearer $WEBOPERATOR_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"url":"https://example.com"}'

curl -X POST http://127.0.0.1:8765/v1/browser/click \
  -H "Authorization: Bearer $WEBOPERATOR_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"ref":"@e12","reason":"open details"}'
```

Browser action payloads:

- `navigate`: `{ "url": "https://example.com", "tabId": 123 }`
- `click`: `{ "ref": "@e12", "reason": "open details", "tabId": 123 }`
- `type`: `{ "ref": "@e4", "text": "hello", "mode": "replace", "submit": "false", "tabId": 123 }`
- `press`: `{ "key": "Enter", "modifiers": "", "ref": "@e4", "tabId": 123 }`
- `scroll`: `{ "direction": "down", "amountPx": 500, "ref": "@e20", "tabId": 123 }`
- `extract`: `{ "refs": "@e1,@e2", "tabId": 123 }`

`tabId` is optional. If omitted, WebOperator uses the active tab in the current window.

## Task Endpoints

```http
POST /v1/tasks
GET /v1/tasks
GET /v1/tasks/:id
GET /v1/tasks/:id/trace
GET /v1/tasks/:id/events
POST /v1/tasks/:id/wait
POST /v1/tasks/:id/stop
POST /v1/tasks/:id/pause
POST /v1/tasks/:id/resume
POST /v1/tasks/:id/confirm
```

Start a task:

```bash
curl -X POST http://127.0.0.1:8765/v1/tasks \
  -H "Authorization: Bearer $WEBOPERATOR_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"goal":"Extract the visible invoice total","autoConfirm":true}'
```

Start task payload:

```json
{
  "goal": "Extract the visible invoice total",
  "startUrl": "https://example.com",
  "tabId": 123,
  "autoConfirm": true,
  "timeoutMs": 60000
}
```

Wait for terminal or paused status:

```bash
curl -X POST http://127.0.0.1:8765/v1/tasks/<task-id>/wait \
  -H "Authorization: Bearer $WEBOPERATOR_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"timeoutMs":120000}'
```

Confirm a pending critical action:

```bash
curl -X POST http://127.0.0.1:8765/v1/tasks/<task-id>/confirm \
  -H "Authorization: Bearer $WEBOPERATOR_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"allow":true}'
```

## Event Streaming

Task events use Server-Sent Events:

```bash
curl -N http://127.0.0.1:8765/v1/tasks/<task-id>/events \
  -H "Authorization: Bearer $WEBOPERATOR_API_TOKEN"
```

Event names:

- `task.snapshot`
- `task.update`
- `task.step`
- `task.error`
- `skills.detected`
- `heartbeat`
- `bridge.status`

Live `task.step` events omit large screenshots, page snapshots, prompt text, and thinking text.
Use `GET /v1/tasks/:id/trace` for the full stored trace.

## Security

Keep the bridge bound to `127.0.0.1`. Do not expose the port to a network.
Set `WEBOPERATOR_API_TOKEN` when another local process will control WebOperator.
Use `WEBOPERATOR_ALLOW_UNAUTHENTICATED_BRIDGE=1` only for local development smoke tests.
