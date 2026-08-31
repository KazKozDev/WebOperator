## What this changes

<!-- One or two sentences. What behaviour is different after this merges? -->

## Why

<!-- The problem being solved. Link the issue if there is one: Fixes #123 -->

## How it was verified

<!-- Delete what does not apply. -->

- [ ] `./scripts/check.sh` passes locally
- [ ] Unit tests added or updated for the changed behaviour
- [ ] Loaded `core/dist` in Chrome and ran the affected flow by hand
- [ ] Ran against a fixture in `evals/fixtures` — which one:
- [ ] Browser eval run (`npm run eval:extension`) — attach or summarize the trace

## Checklist

- [ ] One concern per PR — no unrelated refactors bundled in
- [ ] Commit messages follow Conventional Commits
- [ ] Docs updated if behaviour, a default, a permission, or an env var changed
- [ ] `CHANGELOG.md` updated under `Unreleased` for a user-visible change

## Security-sensitive areas

<!-- Tick anything this PR touches. These get closer review — see CONTRIBUTING.md. -->

- [ ] The prompt-injection boundary (page content reaching the model as instructions)
- [ ] `weboperator-bridge` parsing, binding, or authentication
- [ ] Credential vault or trace/log masking
- [ ] Manifest permissions
- [ ] None of the above
