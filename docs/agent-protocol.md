# WebOperator Agent Protocol

This is the preferred protocol for Hermes and other local agents.

```text
Agent
  -> framed JSON Unix socket
  -> WebOperator Native Messaging host
  -> Chrome extension
  -> active browser tab
```

The Chrome extension starts the Native Messaging host with `chrome.runtime.connectNative("com.weboperator.bridge")`.
Agents do not talk to Chrome directly. They connect to the bridge socket.

## Transport

Default socket:

```text
/tmp/weboperator-bridge.sock
```

Override:

```bash
WEBOPERATOR_AGENT_SOCKET=/path/to/socket
```

Messages use the Chrome Native Messaging frame format:

```text
4-byte little-endian unsigned JSON byte length
UTF-8 JSON payload
```

## Auth

If `WEBOPERATOR_API_TOKEN` is set when the bridge starts, every agent request must include:

```json
{
  "token": "<WEBOPERATOR_API_TOKEN>"
}
```

Events do not require a token after the socket is connected.

## Request

```json
{
  "id": "req-1",
  "type": "browser.snapshot",
  "payload": {},
  "timeoutMs": 30000,
  "token": "optional-if-auth-enabled"
}
```

Fields:

- `id`: caller-generated request id
- `type`: command name
- `payload`: command payload object
- `timeoutMs`: optional request timeout
- `token`: required only when `WEBOPERATOR_API_TOKEN` is set

## Response

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

## Events

The bridge pushes task events to connected socket clients:

```json
{
  "kind": "event",
  "event": {
    "kind": "task:update",
    "task": {}
  }
}
```

Common event kinds:

- `task:update`
- `task:step`
- `task:error`
- `skills:detected`

Large screenshots, page snapshots, prompts, and thinking text are omitted from live step events.
Use `tasks.get` for stored task state and HTTP `GET /v1/tasks/:id/trace` if a full compatibility trace is needed.

## Command Types

Bridge:

- `bridge.health`

Browser:

- `browser.snapshot`
- `browser.screenshot`
- `browser.navigate`
- `browser.click`
- `browser.type`
- `browser.press`
- `browser.scroll`
- `browser.extract`

Tasks:

- `tasks.list`
- `tasks.get`
- `tasks.start`
- `tasks.stop`
- `tasks.pause`
- `tasks.resume`
- `tasks.confirm`
- `tasks.wait`

## Payloads

`bridge.health`:

```json
{}
```

`browser.navigate`:

```json
{
  "url": "https://example.com",
  "tabId": 123
}
```

`browser.click`:

```json
{
  "ref": "@e12",
  "reason": "open details",
  "tabId": 123
}
```

`browser.type`:

```json
{
  "ref": "@e4",
  "text": "hello",
  "mode": "replace",
  "submit": "false",
  "tabId": 123
}
```

`tasks.start`:

```json
{
  "goal": "Extract the visible invoice total",
  "startUrl": "https://example.com",
  "tabId": 123,
  "autoConfirm": true,
  "timeoutMs": 60000
}
```

`tasks.get`, `tasks.stop`, `tasks.pause`, `tasks.resume`, `tasks.wait`:

```json
{
  "id": "task-id"
}
```

`tasks.confirm`:

```json
{
  "id": "task-id",
  "allow": true
}
```

## Example

```bash
WEBOPERATOR_API_TOKEN=dev-token \
  node weboperator-bridge/agent-client.js '{"type":"bridge.health"}'
```

```bash
WEBOPERATOR_API_TOKEN=dev-token \
  node weboperator-bridge/agent-client.js '{"type":"tasks.start","payload":{"goal":"Read the current page title","autoConfirm":true}}'
```
