# Release Checklist

Use this before tagging a release.

## Automated checks

```bash
./scripts/check.sh
```

This must pass:

- TypeScript typecheck
- unit tests
- eval fixture validation
- production build

## Extension smoke test

1. Load `core/dist` in `chrome://extensions`.
2. Open the side panel.
3. Start a simple extraction task on a fixture page.
4. Confirm the plan appears before browser actions.
5. Confirm the trace records tool calls and results.
6. Confirm final `done` appears only after evidence is collected.

## Real scenario smoke test

Run at least one task from each bucket:

- dictionary/evidence lookup
- product comparison or ranked list
- prompt-injection fixture
- form fill on a local fixture
- multi-tab collection
- long task / resume fixture

The experimental automated runner is:

```bash
cd core
npm run eval:extension
```

Use it when a model backend is available. It builds the extension in eval mode, launches Chromium with `core/dist`, starts tasks through the eval-only API, and writes traces to `evals/traces/`. By default it proxies Ollama to avoid local CORS issues.

For remote debugging with Grok/xAI:

```bash
cd core
WEBOPERATOR_PROVIDER=xai WEBOPERATOR_API_KEY=xai-... npm run eval:extension
```

For release-candidate flakiness checks:

```bash
cd core
WEBOPERATOR_PROVIDER=xai WEBOPERATOR_API_KEY=xai-... npm run eval:repeat -- --runs 3
```

For the local Ollama release gate, use a longer timeout because `gemma4:26b` is slower:

```bash
cd core
npm run eval:repeat -- --runs 3 --timeout-ms 600000
```

For each run, export the trace and check:

- first tool call is `set_task_plan`
- no raw JSON final answer
- every final claim has visible evidence
- failed steps are inspectable
- long tasks keep plan progress after resume

## Version rule

- Patch release: bug fix, no behavior contract change.
- Minor release: new supported task type, model client, or runtime guard.
- Major release: stable supported task surface and green end-to-end browser eval suite.

`1.0.0` requires repeatably green end-to-end browser evals on both the primary debug backend and the local Ollama backend.
