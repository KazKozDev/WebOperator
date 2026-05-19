# Security Best Practices Report

Date: 2026-05-19
Project: WebOperator
Scope: TypeScript React Chrome extension, Node.js native messaging bridge, local HTTP/socket API.

## Executive Summary

The project already has several good controls: the local bridge binds to `127.0.0.1` by default, query-string API tokens are rejected, Chrome Native Messaging restricts allowed extension origins, credentials are stored in `chrome.storage.session`, and the new verification gate passes `npm audit`, ESLint, tests, Knip, ShellCheck, and build.

All findings in this report are fixed in the current working tree and covered by regression/smoke checks where applicable.

## High Severity

Status update: SBP-1 has been fixed in the current working tree. The original finding is kept below for audit trail, followed by the fixed evidence.

### SBP-1: Markdown links can inject unsafe `href` attributes into `dangerouslySetInnerHTML`

- Rule: `REACT-XSS-001`, `REACT-XSS-002`, `JS-XSS-001`
- Severity: High
- Status: Fixed in `core/src/sidepanel/App.tsx`; regression tests added in `core/src/sidepanel/App.test.ts`
- Location: `core/src/sidepanel/App.tsx`, `AnswerPanel`, lines 517 and 1133-1154
- Evidence:

Original vulnerable pattern:

```tsx
<div className="answer-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(answer ?? fallback) }} />
```

```ts
html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
```

Fixed pattern:

```ts
html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, rawHref: string) => renderSafeLink(label, rawHref));
```

```ts
function normalizeSafeLinkHref(rawHref: string): string | null {
  const href = rawHref.trim();
  if (!href) return null;

  try {
    const url = new URL(href);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
      return url.href;
    }
  } catch {
    return null;
  }

  return null;
}
```

- Impact: A crafted final answer such as markdown containing quotes in the URL target can break out of the `href` attribute. A `javascript:` URL can also be rendered as a clickable link. Since final answers may summarize untrusted page content through an LLM, a malicious webpage can try to influence the answer and turn the side panel into a DOM XSS sink.
- Fix: Replace the regex-based HTML renderer with a safe renderer, or at minimum escape attribute values and only allow `http:`, `https:`, and `mailto:` link protocols. For untrusted markdown, prefer a vetted sanitizer such as DOMPurify before using `dangerouslySetInnerHTML`.
- Mitigation: Add a regression test for malicious markdown links, including quote injection and `javascript:` URLs.
- Verification: `core/src/sidepanel/App.test.ts` covers attribute breakout, `javascript:` URLs, and safe HTTPS links.
- False positive notes: The initial `&`, `<`, and `>` escaping reduces raw tag injection, but it does not escape quotes used inside generated attributes and does not validate URL protocols.

## Medium Severity

### SBP-2: Local bridge authentication is optional for a browser-control API

- Rule: `EXPRESS-INPUT-001` / general auth hardening for local privileged APIs
- Severity: Medium
- Status: Fixed in `weboperator-bridge/bridge.js`; unauthenticated mode now requires explicit `WEBOPERATOR_ALLOW_UNAUTHENTICATED_BRIDGE=1`
- Location: `weboperator-bridge/bridge.js`, `enforceAuth` and `enforceAgentAuth`, lines 190-198 and 398-401
- Evidence:

```js
function enforceAuth(req, url) {
  if (!API_TOKEN) return;
```

```js
function enforceAgentAuth(msg) {
  if (!API_TOKEN) return;
```

- Impact: When `WEBOPERATOR_API_TOKEN` is unset, any local process that can reach `127.0.0.1:8765` or the Unix socket can attempt to drive the extension API. That API can request browser snapshots, screenshots, navigation, typing, and task actions. Binding to loopback is good, but this is still a privileged local control surface.
- Fix: Generate a per-install random token by default, or require `WEBOPERATOR_API_TOKEN` unless an explicit `WEBOPERATOR_ALLOW_UNAUTHENTICATED_BRIDGE=1` development flag is set.
- Mitigation: Keep the bridge bound to `127.0.0.1`, keep the socket chmod `0600`, and document that unauthenticated mode is development-only.
- False positive notes: This is less severe than a network-exposed API because the default bind host is loopback and browser CORS blocks many web-origin reads. It remains relevant for local process/browser-extension threat models.

## Low Severity / Hardening

### SBP-3: Native bridge logs process metadata to `/tmp`

- Rule: general secret/logging hygiene
- Severity: Low
- Status: Fixed in `weboperator-bridge/bridge.js`; argv logging now redacts common token/secret/password/key flags
- Location: `weboperator-bridge/bridge.js`, lines 10 and 18-22
- Evidence:

Original pattern:

```js
const LOG = process.env.WEBOPERATOR_BRIDGE_LOG || '/tmp/weboperator-bridge.log';
log(`process start pid=${process.pid} ppid=${process.ppid} argv=${JSON.stringify(process.argv)} cwd=${process.cwd()}`);
```

Fixed pattern:

```js
log(`process start pid=${process.pid} ppid=${process.ppid} argv=${JSON.stringify(redactArgv(process.argv))} cwd=${process.cwd()}`);
```

- Impact: The current default log does not include environment variables, so `WEBOPERATOR_API_TOKEN` is not logged. However, if future launch modes pass sensitive values through CLI args, `argv` logging would persist them to a predictable temp path.
- Fix: Keep secrets out of CLI args and consider redacting known-sensitive argv flags before logging.
- Mitigation: Prefer env vars for secrets and keep `/tmp/weboperator-bridge.log` local-only.
- False positive notes: Current code and installer pass the bridge path via `args`, not secrets.

## Positive Findings

- `docs/api.md` states query-string tokens are not supported, and `scripts/bridge-smoke.mjs` verifies `?token=` returns `401`.
- `weboperator-bridge/bridge.js` binds the HTTP bridge to `127.0.0.1` by default.
- `weboperator-bridge/install.sh` writes a Chrome Native Messaging manifest with a specific `allowed_origins` extension ID.
- `core/src/lib/storage.ts` stores saved credentials in `chrome.storage.session`, not persistent local storage.
- `npm audit --audit-level=moderate` currently reports `0 vulnerabilities`.
