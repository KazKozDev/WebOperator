# Supported Tasks

This is the supported task surface for `1.0.0`. Anything outside this list may still work, but should be treated as experimental.

## Good fit

- Extract visible information from web pages.
- Search, open results, and summarize page evidence.
- Compare products or listings when the required fields are visible.
- Fill simple forms with explicit user-provided data.
- Work across a small number of tabs.
- Use a visible plan for multi-step tasks.
- Continue longer tasks through checkpoints and compacted history.
- Interact with spreadsheet-like grids through the dedicated sheet tools.

## Requires care

- Login flows, because credentials and session state vary by site.
- Pages with heavy client-side re-rendering.
- Infinite scroll pages.
- Sites with aggressive bot detection. The agent exposes a `solve_captcha` tool that clicks a
  Cloudflare Turnstile widget or a challenge checkbox when `isBotChallengePage` flags the page.
  It only dispatches a click at the widget: it does not read image or puzzle challenges, does not
  call a solving service, and does not help on a site that keeps re-challenging. Automating a
  challenge widget may breach a site's terms of service, so treat it as a supervised action.
- Tasks that require subjective judgment without clear page evidence.
- Any destructive action, purchase, payment, deletion, or account change.

## Not supported as autonomous tasks

- Defeating image, puzzle, or audio CAPTCHAs, and any other bot-detection bypass beyond the
  single challenge-widget click described above.
- Banking, payments, trading, or legal submissions.
- Bypassing paywalls, access controls, or site restrictions.
- Operating on sensitive personal accounts without explicit user supervision.
- Native desktop automation outside the browser extension path.

## Support rule

A task is supported when it can be verified from the trace: visible observation, tool call, action result, and final answer evidence.
