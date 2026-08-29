# WebOperator — AI browser agent and MCP server for Chrome automation


<!-- TODO(user): add a real 10–20 second demo GIF, 640–800 px, 12–15 fps, ≤5 MB, opaque dark background, absolute URL. -->

Eight AI providers · MCP agent bridge · Open source

---



```bash
git clone https://github.com/KazKozDev/WebOperator.git
cd WebOperator
npm --prefix core ci
npm --prefix core run build
```

## Quick start

The production extension is written to `core/dist`.

```text
vite v8.0.11 building client environment for production...
✓ 98 modules transformed.
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `core/dist`. Open the WebOperator side panel on a page and enter a goal.

## Run a Claude Code-style agent loop in Chrome

WebOperator brings a plan → act → verify → trace loop to a live browser tab. Give it a goal in the Chrome side panel; it builds a visible plan, executes one browser tool at a time, verifies each result, and keeps an inspectable trace.

Choose Ollama, Anthropic, DeepSeek, Gemini, MLX, OpenAI, OpenRouter, or xAI in settings. Local and remote models use the same browser loop.

## Extract and compare visible web data

Use natural-language extraction when the required information is visible on the page. WebOperator can navigate, click, type, scroll, switch tabs, and extract structured text.

```text
Compare the visible delivery date, price, and rating for the products in these tabs.
```

The result stays tied to browser observations; hidden, paywalled, or region-specific details may be absent.

## Connect Hermes and other AI agents through MCP

External agents can use WebOperator as their browser tool. The local bridge exposes nine MCP tools for snapshots, navigation, interaction, screenshots, extraction, and autonomous browser goals.

```bash
cd weboperator-bridge
./install.sh
node mcp-server.js
```

Hermes and OpenClaw configs are included in `weboperator-bridge/`; other MCP-compatible agents can start the same stdio server. Native Messaging connects those agent calls to the active Chrome or Brave tab.

## How it works

The side panel or an external MCP agent supplies the goal. The service worker owns model calls, task state, retries, verification, schedules, and storage. The content script serializes the page into an accessibility snapshot with stable element refs and executes DOM actions. Page content is treated as untrusted data. The side panel displays the plan, answer, and trace while the local bridge connects external agents to the same runtime.

```text
side-panel goal or MCP call → page snapshot → model tool call → verified browser action → trace
```

## Configuration

| Option | Default | What it does |
|---|---:|---|
| Provider | `ollama` | Selects Ollama, Anthropic, DeepSeek, Gemini, MLX, OpenAI, OpenRouter, or xAI. |
| Ollama URL | `http://127.0.0.1:11434` | Sets the local Ollama endpoint. |
| Model profile | `fast` | Maps to the default Ollama model unless a model override is set. |
| Vision policy | `auto` | Controls automatic, always-on, or disabled screenshots. |
| Action timeout | `10000` ms | Limits a browser action attempt. |
| Context compressor | `off` | Uses deterministic history folding, the active model, or a configured cloud model. |
| Domain allowlist | empty | Restricts tasks to matching domains when populated. |
| Domain blocklist | empty | Rejects matching domains. |
| Action cache | enabled | Reuses verified actions for up to 30 days by default. |

### Environment variables

| Variable | Required | What it does |
|---|---:|---|
| `WEBOPERATOR_API_TOKEN` | Recommended | Authenticates bridge HTTP and socket requests. |
| `WEBOPERATOR_BRIDGE_HOST` | No | Sets the HTTP bind host; defaults to `127.0.0.1`. |
| `WEBOPERATOR_BRIDGE_PORT` | No | Sets the HTTP port; defaults to `8765`. |
| `WEBOPERATOR_AGENT_SOCKET` | No | Sets the framed JSON socket path; defaults to `/tmp/weboperator-bridge.sock`. |
| `WEBOPERATOR_BRIDGE_LOG` | No | Sets the bridge log path; defaults to `/tmp/weboperator-bridge.log`. |
| `WEBOPERATOR_EXTENSION_ID` | No | Overrides the extension ID used by the native-host installer. |

## Requirements

- Google Chrome 120 or newer for the extension runtime.
- Node.js and npm to install dependencies and build from source.
- A tool-capable model served by Ollama, or credentials for a supported remote provider.
- An unpacked extension loaded from `core/dist`.
- macOS or Linux for the provided Native Messaging installer; it also installs host entries for supported Chromium-family browsers found on those platforms.
- `shellcheck` only when running the complete local verification gate.

## Limitations

- Dynamic, canvas-heavy, infinite-scroll, bot-protected, or unusual-focus pages can fail or invalidate element refs.
- CAPTCHA solving, payments, trading, legal submissions, paywall bypasses, and unsupervised sensitive-account work are not supported autonomous tasks.
- Long tasks can drift; checkpoints and context compression reduce but do not eliminate that risk.
- Remote providers may receive page observations when configured.
- The provided bridge installer covers macOS and Linux, not Windows.

<details>
<summary>From source, Docker, development setup</summary>

### From source
Run `npm --prefix core ci && npm --prefix core run build`, then load `core/dist` as an unpacked extension.
### Docker
No Dockerfile or Compose configuration is included.
### Development
Run `npm --prefix core run dev` for watch builds or `./scripts/check.sh` for the complete local gate.
</details>

---
<div align="center">

[![Version](https://img.shields.io/badge/version-1.4.0-333?style=flat-square)](core/package.json) [![License](https://img.shields.io/badge/license-MIT-333?style=flat-square)](LICENSE)

[Issues](https://github.com/KazKozDev/WebOperator/issues) · [License](LICENSE) · [API](docs/api.md) · [Architecture](docs/architecture.md) · [Limitations](docs/known-limitations.md)

</div>
