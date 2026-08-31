# WebOperator — AI browser agent and MCP server for Chrome automation

Automate browser tasks in Chrome by describing the goal in plain English.

```bash
git clone https://github.com/KazKozDev/WebOperator.git
npm --prefix WebOperator/core ci
npm --prefix WebOperator/core run build
```

![WebOperator side panel in Chrome showing the task, skills, and schedule views](https://raw.githubusercontent.com/KazKozDev/WebOperator/main/docs/assets/weboperator-demo.gif)

Local models or cloud · Ten MCP tools · Open source



## Quick start

No Node, no build: download the `weboperator-<version>-chrome.zip` archive from
the [latest release](https://github.com/KazKozDev/WebOperator/releases/latest),
unzip it, and skip to the paragraph below. The archive is the built extension.

Building from source instead writes the unpacked extension to `core/dist`.

```text
vite v8.0.11 building client environment for production...
✓ 101 modules transformed.
✓ built in 189ms
```

Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select `core/dist`. Press `Cmd+Shift+K` (`Ctrl+Shift+K` on Linux) to open the side panel, pick a provider under **Settings**, and type a goal.

The default provider is Ollama at `http://127.0.0.1:11434`, so a tool-capable local model needs to be running before the first task. Any of the seven remote providers works instead once you paste a key.

## Automate a multi-step task across your open Chrome tabs

WebOperator runs a plan → act → verify loop against the tab you are looking at. It builds a visible plan, calls one browser tool at a time, verifies each result against a fresh page snapshot, and records an inspectable trace of every step.

```text
Summarize the current page
```

It can navigate, click, type, press keys, scroll, switch tabs, screenshot, and extract structured text — so the same loop works when the information you need is spread across several tabs.

```text
Compare info across tabs
```

The side panel streams the plan, each action, and the final answer; history, checkpoints, and scheduled runs live in their own tabs. Answers stay tied to browser observations, so hidden, paywalled, or region-specific details may simply be absent.

## Schedule recurring browser automation in Chrome

Set a task once and let it run without you. Each schedule stores a start URL, a goal, and how often to repeat it — `once`, `hourly`, `daily`, or `weekly` — and Chrome alarms wake the agent even while the side panel is closed.

```text
Task name:  Morning price check
Start URL:  https://example.com/product
Repeat:     daily
Goal:       Check the price and tell me if it dropped below 40 EUR
```

Every run lands in History with its full trace, so a scheduled task is auditable after the fact rather than a black box. A run that hits something only you can clear — a login wall or a verification challenge — is marked `needs_user` instead of failing quietly.

## Connect Hermes, OpenClaw, or another MCP agent

An external agent can use your live browser as its tool. The local bridge exposes ten MCP tools over stdio: `browser_snapshot`, `browser_navigate`, `browser_click`, `browser_type`, `browser_press`, `browser_scroll`, `browser_screenshot`, `browser_extract`, `browser_solve_captcha`, and `weboperator_execute_goal`.

```bash
cd weboperator-bridge
./install.sh
node mcp-server.js
```

`install.sh` registers the Native Messaging host that connects those calls to the active Chrome or Brave tab. Ready-made configs for Hermes and OpenClaw ship in `weboperator-bridge/`.

## How it works

The side panel or an external MCP agent supplies the goal. The service worker owns model calls, task state, retries, verification, schedules, and storage. The content script serializes the page into an accessibility snapshot with stable element refs and executes DOM actions against them. Page content is treated as untrusted data, never as instructions. Twelve built-in skills act as domain playbooks that steer the agent when a matching site or task is detected.

```text
goal → page snapshot → model tool call → verified action → trace
```

## Permissions

The manifest requests `<all_urls>` and `activeTab`/`tabs`/`scripting` to read and act on the page you point it at, `debugger` to drive Chrome DevTools Protocol actions the DOM API cannot perform, `sidePanel` for the UI, `storage` for settings and history, `alarms` for scheduled tasks, `downloads` for the file-downloader skill, and `nativeMessaging` for the MCP bridge. `bookmarks` and `tabGroups` are optional and requested only when used.

Because of `debugger`, Chrome shows a yellow "WebOperator started debugging this browser" bar while an action runs. That bar is Chrome's, not the extension's, and it disappears when the agent detaches.

## Configuration

| Option | Default | What it does |
|---|---|---|
| Provider | `ollama` | Selects Ollama, Anthropic, DeepSeek, Gemini, MLX, OpenAI, OpenRouter, SiliconFlow, or xAI |
| Ollama URL | `http://127.0.0.1:11434` | Sets the local Ollama endpoint |
| Screenshot policy | `auto` | Controls automatic, always-on, or disabled vision |
| Action timeout | `10000` ms | Limits a single browser action attempt |
| Domain allowlist / blocklist | empty | Restricts or rejects tasks by domain when populated |

### Environment variables

| Variable | Required | What it does |
|---|---|---|
| `WEBOPERATOR_API_TOKEN` | Recommended | Authenticates bridge HTTP and socket requests |
| `WEBOPERATOR_ALLOW_UNAUTHENTICATED_BRIDGE` | No | Set to `0` to reject unauthenticated bridge calls; unauthenticated is the default |
| `WEBOPERATOR_BRIDGE_HOST` | No | HTTP bind host; defaults to `127.0.0.1` |
| `WEBOPERATOR_BRIDGE_PORT` | No | HTTP port; defaults to `8765` |
| `WEBOPERATOR_AGENT_SOCKET` | No | Framed JSON socket path; defaults to `/tmp/weboperator-bridge.sock` |
| `WEBOPERATOR_BRIDGE_LOG` | No | Bridge log path; defaults to `/tmp/weboperator-bridge.log` |
| `WEBOPERATOR_EXTENSION_ID` | No | Overrides the extension ID used by the native-host installer |

## Requirements

- Chrome 120 or newer, or a Chromium browser of equivalent version
- Node.js and npm, to install dependencies and build the extension
- A tool-capable model served by Ollama or MLX, or an API key for Anthropic, DeepSeek, Gemini, OpenAI, OpenRouter, SiliconFlow, or xAI
- The unpacked extension, either from a release archive or built into `core/dist`; it is not on the Chrome Web Store
- macOS or Linux for the MCP bridge installer
- `shellcheck`, only to run the full local check gate

## Limitations

- Dynamic, canvas-heavy, or infinite-scroll pages can invalidate element refs between observation and action.
- Sites with bot detection or unusual focus handling can fail outright.
- Long tasks can drift; checkpoints and context compression reduce but do not eliminate this.
- A configured remote provider receives page observations, including page text and screenshots.
- The bridge listens without authentication unless `WEBOPERATOR_API_TOKEN` is set and unauthenticated calls are disabled.
- Chrome and Brave are the documented targets; other Chromium browsers and Windows are untested, and the bridge installer refuses to run outside macOS and Linux.

## Contributing

Bug reports, feature requests and pull requests are welcome.
[CONTRIBUTING.md](CONTRIBUTING.md) covers the setup, the eight-step check gate
every change has to pass, and the commit conventions. Released versions are
listed in [CHANGELOG.md](CHANGELOG.md).

Found a security problem? Do not open a public issue — report it privately, as
described in [SECURITY.md](SECURITY.md).

<details>
<summary>Manual installation, Docker, development setup</summary>

### From a release
Download and unzip `weboperator-<version>-chrome.zip` from the
[releases page](https://github.com/KazKozDev/WebOperator/releases), then load
the unzipped folder as an unpacked extension. Each archive ships a `.sha256`
next to it, and is built and published by the `release` workflow from the
tagged commit after the full check gate passes.

### From source
Run `npm --prefix core ci && npm --prefix core run build`, then load `core/dist` as an unpacked extension.

### Docker
No Dockerfile or Compose configuration is included.

### Development
Run `npm --prefix core run dev` for watch builds, or `./scripts/check.sh` for the full gate: fixture evals, bridge smoke test, typecheck, lint, unit tests, dead-code scan, shellcheck, and build.

</details>

</br></br>
<div align="center">

[![Check](https://img.shields.io/github/actions/workflow/status/KazKozDev/WebOperator/check.yml?branch=main&style=flat-square&label=check)](https://github.com/KazKozDev/WebOperator/actions/workflows/check.yml) [![Chrome · Brave](https://img.shields.io/badge/Chrome%20%C2%B7%20Brave-MV3-333?style=flat-square)](core/manifest.config.ts) [![Version](https://img.shields.io/badge/version-1.5.0-333?style=flat-square)](core/package.json) [![LICENSE](https://img.shields.io/badge/LICENSE-MIT-333?style=flat-square)](LICENSE)

[Issues](https://github.com/KazKozDev/WebOperator/issues) · [LICENSE](LICENSE) · [API](docs/api.md) · [ARCHITECTURE](docs/architecture.md) · [Agent protocol](docs/agent-protocol.md) · [LinkedIn](https://www.linkedin.com/in/kazkozdev/)

</div>
