# Developer notes

## Models

WebOperator can talk to local and remote model backends. The current code has clients for:

- Ollama
- OpenAI-compatible APIs
- xAI
- OpenRouter
- MLX

The original local path is Ollama:

```bash
ollama serve
ollama pull gemma4:26b
```

Chrome extensions need to be allowed as an origin. If the UI shows `403 Forbidden`, restart Ollama with:

```bash
OLLAMA_ORIGINS="chrome-extension://*,http://localhost:*" ollama serve
```

On macOS, quit the Ollama menu bar app first if it is already running.

## Local agent API

External agents can talk to WebOperator through the optional local bridge in `weboperator-bridge/`. The Chrome extension starts the bridge through Native Messaging, and agents can use the bridge's framed JSON socket or compatibility HTTP API:

```text
Agent -> framed JSON socket -> WebOperator Native Messaging host -> Chrome extension -> active tab
```

Hermes and other agents can connect through this Local Agent API.

Install the native host, then reload the extension:

```bash
cd weboperator-bridge
./install.sh
```

For the framed socket protocol, see `agent-protocol.md`. For token auth, HTTP request/response details, and SSE task events, see `api.md`.

The API can return browser data and run browser actions:

```bash
WEBOPERATOR_API_TOKEN=dev-token \
  node weboperator-bridge/agent-client.js '{"type":"bridge.health"}'

WEBOPERATOR_API_TOKEN=dev-token \
  node weboperator-bridge/agent-client.js '{"type":"browser.snapshot"}'
```

Compatibility HTTP examples:

```bash
curl http://127.0.0.1:8765/health
curl http://127.0.0.1:8765/v1/browser/snapshot
curl -X POST http://127.0.0.1:8765/v1/browser/navigate \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}'
curl -X POST http://127.0.0.1:8765/v1/tasks \
  -H 'content-type: application/json' \
  -d '{"goal":"Extract the visible invoice total","autoConfirm":true}'
```

Useful endpoints:

- `GET /v1/browser/snapshot`
- `GET /v1/browser/screenshot`
- `POST /v1/browser/navigate`
- `POST /v1/browser/click`
- `POST /v1/browser/type`
- `POST /v1/browser/press`
- `POST /v1/browser/scroll`
- `POST /v1/browser/extract`
- `POST /v1/tasks`
- `GET /v1/tasks`
- `GET /v1/tasks/:id`
- `GET /v1/tasks/:id/trace`
- `GET /v1/tasks/:id/events`
- `POST /v1/tasks/:id/wait`
- `POST /v1/tasks/:id/stop`

Task events use Server-Sent Events, so agents can subscribe without polling:

```bash
curl http://127.0.0.1:8765/v1/tasks/<task-id>/events
```

This is local-only by default. Do not expose the bridge port to a network.

## Project layout

```text
core/
  src/
    background/
      agent-loop.ts        the main browser-agent loop
      service-worker.ts    Chrome extension entrypoint
      cdp-actions.ts       debugger/CDP fallback actions

    content/
      content-script.ts    page snapshotting, refs, DOM actions, overlays

    lib/
      tools.ts             tool schema exposed to the model
      prompts.ts           system and repair prompts
      planner.ts           parsing and progress for explicit model plans
      actions.ts           action dispatch
      verifier.ts          action verification
      storage.ts           Dexie/chrome storage helpers
      *-client.ts          model provider clients

    sidepanel/
      App.tsx              React UI
      styles.css           UI styles

docs/
  architecture.md          one-page system map
  evals.md                 browser-agent eval seed set
  supported-tasks.md       supported task surface
  known-limitations.md     explicit failure modes
  release-checklist.md     release smoke test checklist

evals/
  tasks.json               local eval definitions
  fixtures/                deterministic HTML fixtures

scripts/
  check.sh                 local verification
  eval-fixtures.mjs        eval fixture validator
  eval-extension.mjs       optional end-to-end extension eval runner
  eval-repeat.mjs          repeat runner for release-gate flakiness checks

weboperator-bridge/
  bridge.js                local agent bridge for external agents
  install.sh               native-host installer for Chrome
```

## Useful commands

```bash
./scripts/check.sh
```

Or run the core commands directly:

```bash
cd core
npm run typecheck
npm test
npm run build
```

The build output is `core/dist/`.

## Eval runner

The repo includes a local eval fixture suite, release checklist, repeat runner, and end-to-end extension runner.

The end-to-end runner is:

```bash
cd core
npm run eval:extension
```

It launches Chromium with the extension loaded, serves local fixtures, starts tasks through an eval-only extension API, and writes traces to `evals/traces/`. By default it uses Ollama through a local CORS proxy.

To run the same evals against Grok/xAI:

```bash
cd core
WEBOPERATOR_PROVIDER=xai WEBOPERATOR_API_KEY=xai-... npm run eval:extension
```

Optionally set `WEBOPERATOR_MODEL`, or pass `-- --provider xai --model grok-4-1-fast-non-reasoning --api-key xai-...`. It requires a configured model backend and is not part of the default `./scripts/check.sh` gate.

For release-candidate flakiness checks:

```bash
cd core
WEBOPERATOR_PROVIDER=xai WEBOPERATOR_API_KEY=xai-... npm run eval:repeat -- --runs 3
```
