# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
under the version rule in [docs/release-checklist.md](docs/release-checklist.md):
a patch fixes behaviour, a minor adds a supported task type, model client, or
runtime guard, and a major requires a stable task surface with green end-to-end
evals.

## [Unreleased]

Nothing yet.

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

[Unreleased]: https://github.com/KazKozDev/WebOperator/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/KazKozDev/WebOperator/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/KazKozDev/WebOperator/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/KazKozDev/WebOperator/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/KazKozDev/WebOperator/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/KazKozDev/WebOperator/releases/tag/v1.0.0
