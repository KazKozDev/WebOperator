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
- Sites with aggressive bot detection. `detectPageCaptcha` classifies the challenge and `solveCaptcha`
  dispatches on that subtype. Anything it cannot clear falls through to a handoff: the task pauses with a
  `bot_challenge` reason, the side panel focuses the relevant control and gives a matching instruction,
  and the run resumes on its own once the challenge disappears (manual Resume stays available). After two
  handoffs on the same task the run fails and tells you to finish manually. What each subtype does:

  | Subtype | Attempted automatically | Comes back to you |
  |---|---|---|
  | Cloudflare Turnstile / challenge page | `solveCloudflareChallenge` | if the page keeps challenging |
  | reCAPTCHA checkbox | `solveRecaptchaChallenge` | on any interactive prompt |
  | hCaptcha checkbox | `solveHcaptchaChallenge` | on any interactive prompt |
  | AWS WAF, GeeTest radar, Arkose | `solveGenericChallenge`, reached only through the untyped fallback | otherwise |
  | Slider / puzzle | `solveSliderCaptcha` | whenever the drag does not clear it |
  | Image text | `solveVisualTextCaptcha` | whenever no answer is found |
  | Audio | nothing — no solver exists | always |

  Every one of these clicks, drags, or types inside the page. None of them calls an external solving
  service, and no paid solving API is integrated.
- Tasks that require subjective judgment without clear page evidence.
- Any destructive action, purchase, payment, deletion, or account change.

## Not supported as autonomous tasks

- Audio CAPTCHAs. No solver exists for them, so they always come back to you.
- Any challenge outside the table above, and any bypass that would require an external or paid solving
  service. None is integrated.
- Banking, payments, trading, or legal submissions.
- Bypassing paywalls, access controls, or site restrictions.
- Operating on sensitive personal accounts without explicit user supervision.
- Native desktop automation outside the browser extension path.

## Support rule

A task is supported when it can be verified from the trace: visible observation, tool call, action result, and final answer evidence.
