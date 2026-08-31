# Contributing to WebOperator

Thanks for taking the time to contribute. This document covers the setup, the
checks a change has to pass, and the conventions the repository follows.

## Setup

WebOperator is a Chrome extension plus a Node-based MCP bridge. The npm project
lives in `core/`, not in the repository root.

```bash
git clone https://github.com/KazKozDev/WebOperator.git
cd WebOperator
nvm use                  # reads .nvmrc — Node 24
npm --prefix core ci
npm --prefix core run build
```

The build writes the unpacked extension to `core/dist`. Load it through
`chrome://extensions` with Developer mode enabled.

For iterative work use the watch build:

```bash
npm --prefix core run dev
```

`shellcheck` is the one dependency npm does not install. Ubuntu ships it;
on macOS use `brew install shellcheck`. It is only needed for the full gate.

## The check gate

Every pull request must pass the same gate CI runs:

```bash
./scripts/check.sh
```

It runs eight steps in order — fixture evals, bridge smoke test, typecheck,
ESLint, unit tests, the Knip dead-code and dependency scan, ShellCheck, and the
production build. Run it locally before opening a PR; CI runs it on both
`ubuntu-latest` and `macos-latest`, so a change that passes only on one platform
will be caught but is cheaper to find at home.

Individual steps are available as npm scripts in `core/package.json`
(`typecheck`, `lint`, `test`, `deadcode`, `shellcheck`, `build`). Coverage is
reported by `npm --prefix core run test:coverage`.

## Tests

Unit tests live next to the code they cover as `*.test.ts` and run under Vitest.
A change to agent behaviour belongs with a test — the loop guard, the verifier,
the tool validator and the page-state readers all have existing suites to
extend rather than duplicate.

Browser-level evals are separate and not part of the gate, because they need a
model backend. See [docs/evals.md](docs/evals.md) and the runner notes in
[docs/release-checklist.md](docs/release-checklist.md).

## Commit messages

The history follows Conventional Commits:

```text
feat(captcha): add autonomous solver for slider puzzles
fix: read page state from the main frame
docs(readme): warn about the debugger bar in Permissions
chore: pin the Node version
```

Use `feat`, `fix`, `docs`, `chore`, `ci`, `style`, `refactor`, `test` or
`perf`. The scope is optional. These prefixes drive the CHANGELOG, so a
descriptive subject line is worth the extra seconds.

## Pull requests

- Branch from `main`.
- Keep one concern per PR. A refactor bundled with a behaviour change is hard
  to review and harder to revert.
- Fill in the PR template — what changed, why, and how it was verified.
- A green `check` run on both platforms is required before merge.

## Security-sensitive areas

Some parts of the codebase carry more risk than their size suggests. Changes
there get closer review:

- **Prompt-injection boundary.** Page content is untrusted data and must never
  reach the model as instructions. See `core/src/lib/prompts.ts` and the
  injection fixtures in `evals/fixtures`.
- **The bridge.** `weboperator-bridge/` accepts external calls and defaults to
  unauthenticated. Anything touching its parsing, binding or auth path needs a
  test.
- **Credential handling.** The vault and masking code paths must not widen what
  is written to traces or logs.

Do not open a public issue for a vulnerability — see [SECURITY.md](SECURITY.md).

## Documentation

`README.md` holds the short version; the detail lives in `docs/`. A change that
alters behaviour, a permission, a default or an environment variable should
update both. `docs/known-limitations.md` is the honest list — adding to it is a
contribution, not an admission.

## Releases

Releases are cut by pushing a `v*` tag; the `release` workflow rebuilds from
that commit, runs the gate, and publishes the extension archive with notes
taken from `CHANGELOG.md`. Add user-visible changes under `Unreleased` as you
go — that section becomes the release notes, so writing it later means writing
it from memory. The full procedure is in
[docs/release-checklist.md](docs/release-checklist.md).

## Code of conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
