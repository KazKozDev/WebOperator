import type { A11ySnapshot, Settings, VisualTokenBudget } from './types';
import { isErrorPageSnapshot } from './page-state';

export interface VisionContext {
  stepIndex: number;
  requestedByModel?: boolean;
  isIframeOnly?: boolean;
  lastStepFailed?: boolean;
}

export interface VisionDecision {
  attach: boolean;
  reason: string;
  visualTokens: VisualTokenBudget;
  isVerification: boolean;
}

export function shouldAttachScreenshot(
  snapshot: A11ySnapshot,
  settings: Settings,
  ctx: VisionContext,
): VisionDecision {
  const base: VisualTokenBudget = settings.visualTokenBudget;
  const verify: VisualTokenBudget = settings.visualTokenBudgetVerify;

  if (settings.screenshotPolicy === 'never') return { attach: false, reason: 'policy=never', visualTokens: base, isVerification: false };
  if (settings.screenshotPolicy === 'always') return { attach: true, reason: 'policy=always', visualTokens: base, isVerification: false };

  // A page that cannot be read at all has nothing to photograph either: Chrome's error page is
  // the same few words every time, and spending a screenshot on it buys nothing.
  if (isErrorPageSnapshot(snapshot))
    return { attach: false, reason: 'tab is on an error page — nothing to see', visualTokens: base, isVerification: false };
  if (snapshot.nodes.length === 0)
    return { attach: true, reason: 'empty a11y snapshot (canvas/shadow DOM) — read the page from the screenshot, refs are unavailable', visualTokens: verify, isVerification: true };
  if (ctx.requestedByModel)
    return { attach: true, reason: 'model requested visual verification', visualTokens: verify, isVerification: true };
  if (ctx.isIframeOnly)
    return { attach: true, reason: 'iframe without a11y access', visualTokens: verify, isVerification: true };
  if (ctx.lastStepFailed)
    return { attach: true, reason: 'retry after failed step', visualTokens: verify, isVerification: true };

  return { attach: false, reason: 'a11y sufficient', visualTokens: base, isVerification: false };
}

export function isDomainAllowed(url: string, settings: Settings): { allowed: boolean; reason?: string } {
  let host: string;
  try { host = new URL(url).hostname; } catch { return { allowed: false, reason: 'invalid URL' }; }
  if (settings.blacklist.some((pat) => matches(host, pat))) return { allowed: false, reason: `blocked by blacklist (${host})` };
  if (settings.whitelist.length > 0 && !settings.whitelist.some((pat) => matches(host, pat))) {
    return { allowed: false, reason: `not in whitelist (${host})` };
  }
  return { allowed: true };
}

function matches(host: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  const h = host.toLowerCase();
  if (p.startsWith('*.')) return h === p.slice(2) || h.endsWith(p.slice(1));
  return h === p || h.endsWith(`.${p}`);
}
