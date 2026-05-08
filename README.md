
<p align="center">
  <img src="icons/icon128.png" alt="WebOperator icon" width="128" />
</p>

# WebOperator

Tell your browser what to do. A small browser agent that lives inside Chrome.

You give it a task in the side panel. It looks at the active tab, asks an LLM what to do next, and executes browser tools such as `click`, `type`, `navigate`, `extract`, and `done`. The interesting part is not the UI. The interesting part is the loop: observe the page, make one tool call, verify the effect, update the trace, repeat.

The interface is natural language: describe what you want done, and the agent turns that into a visible plan and browser tool calls.

This repo is intentionally not a framework. It is a Chrome extension with the agent loop in plain TypeScript.

<p align="center">
  <img src="docs/assets/webim.png" alt="WebOperator side panel interface" />
</p>

## Quick start

```bash
cd core
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select `core/dist`.
5. Open a tab you want the agent to operate on.
6. Open the WebOperator side panel and describe the task in natural language.

For development:

```bash
cd core
npm run dev
```

This runs a watch build. Reload the extension after rebuilds.

For local models, the bridge API, project layout, evals, and maintainer commands, see `docs/developer-notes.md`.

## What the agent sees

Each step starts from an observation:

- the current URL and title
- a compact accessibility snapshot
- stable element refs like `@e12`
- visible text snippets
- optional screenshot / set-of-mark overlay
- the visible task plan
- previous tool results

Page content is treated as untrusted observation. It is not allowed to instruct the model.

## The loop

At a high level:

```text
snapshot page
build prompt
LLM returns exactly one tool call
execute tool call
verify action result
save trace
repeat
```

The loop is in `core/src/background/agent-loop.ts`.

The content script owns browser-page mechanics: accessibility extraction, element refs, DOM actions, overlays, and extraction. The background worker owns planning, retries, model calls, action verification, storage, and task status.

## Planning

The agent is forced to plan through a tool call:

```text
set_task_plan(steps, reason)
```

This is deliberate. The extension should not invent a local heuristic plan from the user prompt. The LLM must first state its interpretation of the user intent and produce a concrete 3-8 step plan. The side panel renders this plan and tracks progress through it.

If the model tries to browse, click, type, extract, or finish before setting a plan, the loop blocks the action and asks for `set_task_plan` again.

## Tool calls

The model must return tool calls, not prose JSON. For example:

```text
navigate(url)
click(ref, reason)
type(ref, text, mode, submit)
extract(refs, note)
done(success, summary)
```

If the model answers with plain text or raw JSON, the loop performs one repair turn and asks for a valid tool call. If repair fails, the task fails loudly instead of silently drifting.

## Long tasks

Long tasks are handled by checkpointing and compacting history. The agent can:

- keep a visible plan
- start and finish subtasks
- update task memory
- resume after bounded step windows
- compact old history before continuing
- keep step ids globally unique across resume windows

This is still a browser agent, so it can get stuck. The UI keeps the trace visible so the failure mode is inspectable.

## Safety rails

The extension includes a few simple rails:

- domain allow/block checks
- confirmation for critical actions
- password masking in snapshots, storage, UI events, and export
- action result verification
- DOM hash checks for cache replay
- evidence checks before final `done`
- local history stored in IndexedDB

There is no telemetry. Exports happen only when the user clicks export.

## Skills, schedules, and vault

WebOperator has a small set of built-in skills. They are just prompt playbooks for common browser work: filling forms, extracting data, using Google Sheets, managing tabs, shopping, email, login flows, and downloads. The agent can auto-select them from the task text, or you can turn them on manually.

There is also a local scheduler for recurring browser tasks, and a local credential vault for login flows. The vault is not magic: the agent can only use saved credentials through an explicit `fill_login_credentials` tool call. Passwords are masked in snapshots, traces, UI events, and exports. The agent should never invent, print, or leak credentials.

## Current status

This is a working browser-agent extension with a stable `1.0.0` supported task surface. It is also useful for inspecting the anatomy of a browser agent:

- how to serialize a web page into an LLM observation
- how to force one-tool-at-a-time execution
- how to show the model's plan in the UI
- how to repair missing tool calls
- how to make long tasks less fragile
- how to keep traces debuggable

For local evals and release checks, see `docs/developer-notes.md`.

## Privacy

By default, the local path talks to Ollama on your machine. Remote providers can be configured in settings. Treat any remote provider as remote execution of the prompt: page snapshots and extracted text may be sent to that provider.

Passwords are masked, but do not ask the agent to operate on sensitive accounts unless you have inspected the trace behavior and trust the configured model backend.

<p align="center">
  <img src="docs/assets/futter.png" alt="WebOperator" />
</p>
