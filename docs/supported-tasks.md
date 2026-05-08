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
- Sites with aggressive bot detection.
- Tasks that require subjective judgment without clear page evidence.
- Any destructive action, purchase, payment, deletion, or account change.

## Not supported as autonomous tasks

- CAPTCHA solving.
- Banking, payments, trading, or legal submissions.
- Bypassing paywalls, access controls, or site restrictions.
- Operating on sensitive personal accounts without explicit user supervision.
- Native desktop automation outside the browser extension path.

## Support rule

A task is supported when it can be verified from the trace: visible observation, tool call, action result, and final answer evidence.
