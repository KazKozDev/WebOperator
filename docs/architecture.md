# Architecture

WebOperator is a Chrome extension with one main idea: keep the agent loop small enough to inspect.

## pieces

```text
side panel       user task, settings, plan, answer, trace
service worker   task lifecycle, model calls, tool loop, storage
content script   page snapshot, element refs, DOM actions, overlays
model clients    Ollama / OpenAI-compatible / Anthropic / Gemini / xAI / OpenRouter / SiliconFlow / DeepSeek / MLX
```

## step lifecycle

```text
1. capture the current tab state
2. serialize it into an observation
3. include the visible task plan and previous tool results
4. ask the model for exactly one tool call
5. reject non-tool-call prose and run one repair turn
6. execute the tool
7. verify the result
8. persist the step
9. update the side panel
```

The core loop is `core/src/background/agent-loop.ts`.

## page observation

The content script produces:

- URL and title
- viewport metadata
- accessibility nodes with refs like `@e12`
- visible text snippets
- DOM hash
- optional screenshot / set-of-mark overlay

Page text is untrusted. It is data, not instruction.

## planning

The first model action must be:

```text
set_task_plan(steps, reason)
```

The reason states the model's interpretation of the user intent. The steps are a concrete 3-8 item plan. The side panel renders this plan and the loop tracks progress against it.

No local heuristic plan is created from the user prompt.

## tools

Tools are declared in `core/src/lib/tools.ts` and dispatched through `core/src/lib/actions.ts`.

Common tools:

- `navigate`
- `click`
- `type`
- `press`
- `extract`
- `done`
- tab tools
- spreadsheet tools
- subtask and memory tools

The model gets one tool call per step.

## repair

If the model returns prose or raw JSON instead of a tool call, the loop performs one repair request with a stricter prompt. If repair also fails, the task fails loudly.

This is intentional. Silent format drift is worse than a visible failure.

## long tasks

Long tasks rely on:

- visible plan state
- subtask control tools
- task memory updates
- checkpoints
- history compaction
- bounded step windows
- globally unique step ids across resumes

The trace should make it obvious where the task drifted or failed.

## context compression

To keep long tasks inside the model's context window (local models run with a small
`num_ctx`), the loop compresses context continuously (see `lib/context-compression.ts`,
following arXiv:2510.00615 "Acon"):

- **Observation window** — only the last few page snapshots stay full; older ones collapse
  to a one-line summary (URL, title, element count). The action taken on each is preserved
  in the assistant tool-call that follows it.
- **Budget fold** — when the estimated token count exceeds a provider-aware budget, older
  whole steps are folded into a single progress summary. The cut always lands on a step
  boundary, so assistant/tool-call pairs are never split.
- **Smart compressor** (optional, `contextCompressor` setting, default off) — rewrites the
  folded summary with an LLM (the active model, or DeepSeek/Gemini in cloud mode). One extra
  call only when the budget is exceeded; falls back to the deterministic digest on any error.

## storage

Task history and traces are stored locally. Password-like fields are masked before storage, UI events, and export.

There is no telemetry path. Remote model providers can still receive page observations if configured by the user.

## eval API

Development builds expose an eval-only runtime message API:

- `eval:startTask`
- `eval:getTask`
- `eval:waitTask`
- `eval:clear`

Production builds reject these messages. The extension eval runner uses this API to test the agent loop without clicking through the side panel UI.
