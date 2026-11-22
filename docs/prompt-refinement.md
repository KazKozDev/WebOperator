# Improving a task before execution

## Decision

Use a short, intent-preserving rewrite: goal, supplied context, constraints, and observable completion condition. Keep simple tasks short. Use sections only when they help explain a complex request.

This is an architectural choice, not a claim that one named prompting framework is universally best. WebOperator already constructs its system instructions in `core/src/lib/prompts.ts`, classifies skills, retrieves conversation/site context, and runs a planning and observation/action loop in `core/src/background/agent-loop.ts`. The user's draft is the goal inside that loop. Adding another role, chain-of-thought request, rigid browser plan, or tool protocol to the draft duplicates or conflicts with those responsibilities. Element refs and selectors must come from live observations, not from the rewrite.

Sources consulted on 2026-10-24:

- [Anthropic: Effective context engineering for AI agents](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents): concise, high-signal context; instructions at an appropriate level; avoid brittle procedural instructions and overly vague goals.
- [OpenAI: A practical guide to building agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/): clear instructions, explicit outcomes, conditional handling of missing information, and evaluation before claiming an improvement.

## Behavior

The sparkle button next to the paperclip sends only the draft to the currently configured provider. It uses the existing provider router and planning model selection. It supplies no browser tools and reads no page, attachment content, credentials, or conversation history. Follow-up references remain unresolved for the normal agent context to resolve later.

The model adapts its wording to research, extraction, browser actions, and conversational follow-ups. It must preserve language, scope, exact values and URLs, restrictions, and the distinction between researching, drafting, and taking action. It checks for intent drift before returning a structured JSON result containing the rewritten prompt, up to five concise changes, and up to three essential clarification questions. This is a single model call; explanations are not a second independent verification pass. Missing facts must remain missing.

The result appears in an editable preview beside the original (expandable), its changes, and its questions. The main input is unchanged until Apply prompt is clicked. Discard leaves the original intact; Undo restores it after applying. Start is a separate action. If the original changes while a request is pending, the response is discarded; if it changes after a preview is shown, Apply is disabled. Provider or schema errors leave the original intact. Requests have a 45-second timeout and an 8000-character prompt limit.

An independent deterministic check compares numeric literals and exact HTTP(S) URLs with the original and shows bounded warnings if any are missing or reformatted. It reruns when the preview is edited. This check does not verify names, negations, intent, or permissions, and it may flag equivalent number formatting. Warnings require user review rather than silently altering values or blocking legitimate edits.

This makes one additional model request, which may incur the selected provider's normal cost. No new model account or key is needed.

## Validation and limits

Unit tests cover the provider request, separation of instructions and draft data, structured result validation and size limits, disabled tool execution, model selection, failure propagation, numeric/URL warnings, preview escaping and disabled state, and the button's presence beside Attach. These are deterministic wiring checks, not measurements of rewrite quality or resistance to all prompt injection.

Before claiming better task success, compare original and rewritten goals on the same browser fixtures and model. Include simple navigation, extraction with exact quantities, a multi-site comparison, a negated action ("do not buy"), an authorized action, and a follow-up reference. Score intent/value preservation and actual task completion, and compare latency and token cost. Rewrites remain editable because a model can change meaning despite the instructions. Live browser interaction and a model-quality benchmark have not been completed for this change.
