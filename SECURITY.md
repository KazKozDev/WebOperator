# Security Policy

## Supported versions

WebOperator is distributed as an unpacked extension built from source, not
through the Chrome Web Store. Only the latest release line receives fixes.

| Version | Supported |
|---|---|
| 1.4.x | Yes |
| < 1.4 | No — rebuild from `main` |

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private reporting:
[Report a vulnerability](https://github.com/KazKozDev/WebOperator/security/advisories/new).

Please include:

- what an attacker can do, not only what looks wrong;
- the affected component — extension, content script, service worker, or the
  `weboperator-bridge` native host;
- reproduction steps, ideally against a local fixture in `evals/fixtures`;
- the version or commit, your OS, and your Chrome version.

Expect an acknowledgement within 7 days and an assessment within 14. If a
report is accepted, the fix ships on `main` and the advisory is published once
users have had a chance to rebuild. Reporters are credited unless they ask not
to be.

## Threat model

This project drives a real browser holding real sessions. A few properties are
security-relevant by design, and understanding them keeps reports on target.

**Page content is untrusted data.** The agent serializes a page into an
accessibility snapshot and passes it to a model as observations, never as
instructions. Any path where page-controlled text can steer the agent's actions
is a vulnerability — the `prompt-injection.html` fixture exists precisely to
guard this boundary.

**The extension is highly privileged.** The manifest requests `<all_urls>` plus
`debugger`, so a compromise of the agent loop reaches every site the user is
logged into. Escalation from page content to a browser action counts as high
severity.

**A remote provider sees what the agent sees.** When a cloud provider is
configured, page text and screenshots leave the machine. This is documented
behaviour, not a vulnerability; the local Ollama and MLX paths exist for users
who need the data to stay put.

## Known accepted risks

These are documented rather than fixed, and reporting them is not a finding:

- **The bridge defaults to unauthenticated.** `weboperator-bridge` accepts calls
  without a token unless `WEBOPERATOR_API_TOKEN` is set *and*
  `WEBOPERATOR_ALLOW_UNAUTHENTICATED_BRIDGE=0`. It binds to `127.0.0.1` by
  default, so exposure is limited to local processes. Setting a token is
  recommended, and a bypass of a *configured* token is very much a finding.
- **Chrome's debugger banner.** The yellow "WebOperator started debugging this
  browser" bar is Chrome's own, not a spoofing surface owned by the extension.
- **Agent misbehaviour without a security boundary crossed** — a wrong answer,
  a drifting long task, a failed action — belongs in a regular issue. See
  [docs/known-limitations.md](docs/known-limitations.md).

## Hardening for operators

- Set `WEBOPERATOR_API_TOKEN` and `WEBOPERATOR_ALLOW_UNAUTHENTICATED_BRIDGE=0`
  before exposing the bridge to any external agent.
- Keep `WEBOPERATOR_BRIDGE_HOST` at `127.0.0.1` unless you have a reason and a
  firewall.
- Use the domain allowlist or blocklist to bound what a task may touch.
- Prefer a local model provider when the pages involved are sensitive.

A prior audit of the bridge and storage paths is kept in
[security_best_practices_report.md](security_best_practices_report.md).
