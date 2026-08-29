import type { OllamaMessage } from './ollama-client';
import type { A11ySnapshot, Settings } from './types';

// How many of the most recent page snapshots stay in the history at full size.
// Older observations are collapsed to a one-line summary (the action taken on them
// is preserved in the assistant tool-call message that follows each observation).
export const OBSERVATION_WINDOW = 2;

// How many of the most recent whole steps are kept verbatim when the history is
// folded for budget. Cutting at a step boundary keeps assistant/tool pairs intact.
const KEEP_RECENT_STEPS = 2;

const LOCAL_TOKEN_BUDGET = 6000;
const CLOUD_TOKEN_BUDGET = 24000;

export interface ObservationRef {
  msg: OllamaMessage;
  summary: string;
  collapsed: boolean;
}

/** One-line replacement for a full page snapshot once it scrolls out of the window. */
export function snapshotSummary(s: A11ySnapshot): string {
  const title = s.title?.trim() || 'untitled';
  return `[PAGE SNAPSHOT collapsed to save context] ${title} — ${s.url} · ${s.nodes.length} elements`;
}

/** Rough char→token estimate (≈4 chars/token), good enough to drive compaction. */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

export function historyTokens(history: OllamaMessage[]): number {
  return history.reduce((sum, m) => sum + estimateTokens(m.content ?? ''), 0);
}

export function contextTokenBudget(settings: Settings): number {
  const local = settings.provider === 'ollama' || settings.provider === 'mlx';
  return local ? LOCAL_TOKEN_BUDGET : CLOUD_TOKEN_BUDGET;
}

/** Register a freshly pushed observation message so it can be collapsed later. */
export function trackObservation(refs: ObservationRef[], msg: OllamaMessage, summary: string): void {
  refs.push({ msg, summary, collapsed: false });
}

/** #1 — collapse every observation except the last `keepLast` to its one-line summary, in place. */
export function collapseOldObservations(refs: ObservationRef[], keepLast = OBSERVATION_WINDOW): void {
  const cutoff = refs.length - keepLast;
  for (let i = 0; i < cutoff; i++) {
    const ref = refs[i];
    if (ref.collapsed) continue;
    ref.msg.content = ref.summary;
    ref.collapsed = true;
  }
}

/**
 * #2 — index in `history` where the kept tail (last `keepSteps` whole steps) begins.
 * Cutting here never splits an assistant tool-call from its tool result, because every
 * step starts with a user observation message. Returns -1 when nothing is safe to fold.
 */
export function foldBoundary(history: OllamaMessage[], refs: ObservationRef[], keepSteps = KEEP_RECENT_STEPS): number {
  if (refs.length <= keepSteps) return -1;
  const boundary = refs[refs.length - keepSteps].msg;
  const cut = history.indexOf(boundary);
  return cut > 1 ? cut : -1;
}

/** Drop observation refs whose messages are no longer present in `history` (folded away). */
export function pruneObservationRefs(history: OllamaMessage[], refs: ObservationRef[]): void {
  for (let i = refs.length - 1; i >= 0; i--) {
    if (!history.includes(refs[i].msg)) refs.splice(i, 1);
  }
}
