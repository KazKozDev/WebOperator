# Requirements

What WebOperator needs to build, run, and develop against. The README keeps a
short version of this list; the details live here.

## Build toolchain

| Requirement | Version | Where it is pinned |
|---|---|---|
| Node.js | 24 or newer | `.nvmrc` and `engines.node` in `core/package.json` |
| npm | ships with Node 24 | — |

`.nvmrc` is the single source of truth: the CI workflow reads it through
`node-version-file`, so a local `nvm use` puts you on exactly the version the
gate runs on.

The dependency set technically accepts older runtimes — Vite asks for
`^20.19.0 || >=22.12.0`, ESLint for `^20.19.0 || ^22.13.0 || >=24`, Vitest for
`^20.0.0 || ^22.0.0 || >=24.0.0`. Nothing below 24 is tested, which is why
`engines` is set to `>=24` rather than to that union.

## Browser

- Chrome 120 or newer. The floor comes from `minimum_chrome_version` in
  `core/manifest.config.ts`, not from a guess.
- Brave is a documented target: `weboperator-bridge/install.sh` registers the
  Native Messaging host for it, and `weboperator-bridge/SKILL.md` names it.
- The extension is not on the Chrome Web Store. It is loaded unpacked from
  `core/dist`.
- Other Chromium browsers are untested. The installer also writes host entries
  for Chromium, Edge, Chrome Canary and Arc, but nothing verifies them.

## Models

The agent needs one tool-capable model. Vision is used when the screenshot
policy calls for it.

- **Local:** Ollama (default, `http://127.0.0.1:11434`) or MLX
  (`http://127.0.0.1:8000`). Nothing leaves the machine.
- **Remote:** Anthropic, DeepSeek, Gemini, OpenAI, OpenRouter, SiliconFlow or
  xAI, each with its own API key. A remote provider receives page observations,
  including page text and screenshots.

## MCP bridge

Only needed to drive the browser from an external agent.

- macOS or Linux. `weboperator-bridge/install.sh` exits with "Unsupported OS."
  anywhere else, so Windows has no supported path.
- The bridge accepts unauthenticated calls unless `WEBOPERATOR_API_TOKEN` is
  set and `WEBOPERATOR_ALLOW_UNAUTHENTICATED_BRIDGE=0`. See the environment
  variable table in the README.

## Development

- `shellcheck` — only for `npm run shellcheck` and the full gate. Preinstalled
  on Ubuntu; `brew install shellcheck` on macOS.
- Everything else comes from `npm --prefix core ci`.

`./scripts/check.sh` runs the whole gate: fixture evals, bridge smoke test,
typecheck, lint, unit tests, dead-code scan, shellcheck and the production
build. CI runs the same script on `ubuntu-latest` and `macos-latest` for every
push and pull request against `main`, so both operating systems are checked on
each change.
