# Known Limitations

WebOperator is a browser agent with explicit operating limits. The failure modes should stay visible even after `1.0.0`.

## Model behavior

- Models can fail to return a tool call.
- Models can produce a weak or over-broad plan.
- Models can summarize too early if the prompt and runtime gates do not block it.
- Models can confuse page content with instructions if the untrusted boundary is not enforced.

The loop has repair and guardrails, but they are not a proof of correctness.

## Browser behavior

- Dynamic pages can change refs between observation and action.
- Canvas-heavy or custom-rendered UIs may not expose useful accessibility nodes.
- Infinite scroll pages can hide required data behind stateful loading.
- Sites with bot detection, CAPTCHAs, or unusual focus handling may fail. A detected challenge
  pauses the task and hands the tab back to you rather than failing silently.

## Data and evidence

- The agent should only make final claims supported by visible page content or extracted text.
- If a site hides important details behind hover, login, paywall, or region-specific content, the trace may be incomplete.
- Remote model providers may receive page observations when configured.

## Long tasks

- Long tasks can still drift after many steps.
- Resume depends on checkpoint quality and compacted history.
- Subtask progress is inspectable, not guaranteed.

## Release status

`1.0.0` has a stable supported task surface and repeatably green local fixture evals on both Grok/xAI and Ollama. These limits still apply to arbitrary real websites.
