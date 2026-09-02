# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
under the version rule in [docs/release-checklist.md](docs/release-checklist.md):
a patch fixes behaviour, a minor adds a supported task type, model client, or
runtime guard, and a major requires a stable task surface with green end-to-end
evals.

## [Unreleased]

### Added

- An `openai-compatible` provider: a base URL, an optional API key, and a model
  name, for any server speaking the OpenAI chat-completions dialect — LM Studio,
  vLLM, llama.cpp, LiteLLM, Together, Groq, Fireworks, or a corporate gateway.
  The key is optional, so a keyless local server works, and the base URL is
  accepted as a bare host, a `/v1` root, or a full endpoint.
- Two built-in skills. `site-search` drives a site's own search box, filters and
  pagination, for answers that live inside one site rather than on a results
  page. `fact-checker` verifies a single claim against its primary source and
  reports CONFIRMED, REFUTED or UNVERIFIABLE with a dated source.
- The `researcher` playbook now narrows a query with operators before opening
  links, picks a specialised index over a general engine, and works down a
  ladder of fallbacks — archive, text mirror, PDF version, another source —
  before giving up on a blocked page.

### Fixed

- Page content could break out of the block that marks it as untrusted. The
  observation fence used fixed, public markers, so a page that printed the
  closing marker in its own text had everything after it read as instruction
  rather than data — and the URL and tab title, both page-controlled, sit at the
  top of that block. The fence now carries a random per-observation tag the page
  cannot guess, and marker-shaped text inside it is defanged.
- A model without reasoning or vision support no longer fails every task. The
  agent asks for thinking on the first step of every run and attaches a
  screenshot under the default vision policy; Ollama answers an unsupported
  capability with an error rather than ignoring the request, so a tool-capable
  model missing either died before its first browser action. The client now
  drops the capability the error names, remembers it for that model, and
  retries. The step trace says which capability was dropped, so a run working
  from the page snapshot alone is visible rather than silent.
- Skill keywords matched anywhere inside a word, so "форма" fired on
  "информацию" and pulled the form filler into every research task. Keywords now
  start at a word boundary, and long Russian keywords match by stem so inflected
  forms still hit. Short keywords have to be the whole word, which stops "поле"
  from firing on "полезные" and "form" on "format".
- At most two skill playbooks now reach a task prompt, chosen by routing score
  with keyword hits ranked above semantic ones, and skills declared as
  conflicting resolve to the better-scoring one. Every matching skill used to be
  concatenated into the prompt at once.
- The semantic router no longer indexes skill prompts, so rewording a playbook
  cannot silently change which goals it matches.

## [1.5.0] — 2026-08-31

### Added

- Stopping a run now keeps its work. A stopped task gets its own `stopped`
  status instead of being recorded as a failure, and the agent writes a summary
  of what it collected and what the goal still does not cover — falling back to
  a summary built without the model when a provider is unreachable.
- Follow-up questions about a finished or stopped run, answered from that run's
  own evidence without revisiting any page.
- Resuming after a pause tells the model the page, tab, or login state may have
  changed while it was stopped, so a user's intervention is not mistaken for
  the agent's own progress.

### Changed

- Migrated to `@types/chrome` 0.2.x, which types `chrome.storage` reads as an
  untyped bag rather than pretending the stored shape is known. Settings,
  memory and checkpoint reads now state what they expect and keep their
  existing runtime guards. No behaviour change.
- Updated ESLint, Knip and typescript-eslint.
- Moved to React 19. No source changes were needed: the panel already mounts
  through `createRoot` and uses none of the APIs React 19 removed.
- Contribution, security and conduct documents, issue and pull-request
  templates, Dependabot, CodeQL and a nightly `npm audit`, plus a coverage
  floor wired into CI.
- Tagging a release now builds and publishes the unpacked extension as a zip
  archive, so installing needs no Node and no build step.

## [1.4.0] — 2026-08-31

### Added

- CAPTCHA handling grew from detection into an autonomous solver: Cloudflare
  Turnstile, reCAPTCHA and hCaptcha checkboxes, slider puzzles, visual text
  challenges, and generic AWS WAF, GeeTest and Arkose flows, with retry polling
  and natural pointer events. Anything it cannot clear is handed back in the
  live tab with a sticky resume banner, and the task resumes automatically
  instead of failing silently.
- PDF export for task reports, replacing the raw JSON trace download.
- Smart scroll with container detection and boundary feedback.
- AssistantBench eval tasks and a fetch script for them.
- An Agent Connection section in the side panel, with Export moved next to Copy.
- CI runs the check gate on `ubuntu-latest` and `macos-latest`, and the README
  carries a check badge.

### Changed

- Node is pinned through `.nvmrc` and `engines.node`, with the requirements
  documented in `docs/requirements.md`.
- The loop guard is stricter, cutting repeated no-progress actions earlier.

### Fixed

- Page state is read from the main frame rather than whichever iframe answers
  first — an ad or embed could previously win the race and describe the wrong
  document.
- Transient LLM rate limits are retried, and duplicate subtasks no longer
  appear in the task view.
- CAPTCHA detection no longer fires on ordinary pages running background
  scripts.

## [1.3.0] — 2026-08-29

### Added

- A Custom Skills Builder in the UI, with storage integration.
- Neural skills, a Turnstile solver, a file reader, checkpoint resume, smart
  crop, and voice input.
- A framed agent bridge protocol.

### Fixed

- Bridge startup arguments are redacted from logs.
- The local bridge and markdown link handling were hardened.

## [1.2.0] — 2026-05-08

### Added

- A task event streaming API.

### Removed

- The legacy MCP server, superseded by `weboperator-bridge`.
- The Hermes-specific connector, replaced by the generic MCP configs.

## [1.1.0] — 2026-05-08

### Added

- A local agent API bridge.
- Documentation for skills, schedules, and the credential vault.

## [1.0.0] — 2026-05-08

First public release. A Chrome side-panel browser agent running a
plan → act → verify loop, with local and remote model providers, scheduled
tasks, history with inspectable traces, and an MCP bridge exposing the browser
as a tool to external agents.

[Unreleased]: https://github.com/KazKozDev/WebOperator/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/KazKozDev/WebOperator/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/KazKozDev/WebOperator/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/KazKozDev/WebOperator/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/KazKozDev/WebOperator/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/KazKozDev/WebOperator/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/KazKozDev/WebOperator/releases/tag/v1.0.0
