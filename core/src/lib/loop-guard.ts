import type { ToolCall } from './types';

const LOOP_GUARD_WINDOW = 8;
const MAX_CYCLE_LENGTH = 4;

// The cycle check above only fires on an identical call while the page stays put, so it misses
// the two ways a run actually spins: scrolling a page over and over looking for content that is
// not in the snapshot, and touring the same handful of URLs — each navigation "changes the page"
// and resets the cycle state. These two bound both.
const REVISIT_LIMIT = 3;
const SCROLL_RUN_LIMIT = 6;

export interface LoopGuardState {
  noEffectSignatures: string[];
  /** How many times a (url, tool, ref) triple has been attempted across the whole task. */
  visits: Record<string, number>;
  /** Consecutive scrolls on one URL. */
  scrollRun: { url: string; count: number };
}

export interface LoopGuardDecision {
  blocked: boolean;
  cycleLength: number;
  noEffectActions: number;
}

export function createLoopGuardState(): LoopGuardState {
  return { noEffectSignatures: [], visits: {}, scrollRun: { url: '', count: 0 } };
}

/**
 * Records this attempt and returns a corrective message when the agent is going in circles:
 * the same action on the same page for the third time, or a long run of scrolling that keeps
 * not finding anything. Returns null while the run still looks like progress.
 */
export function detectRepeatedVisit(state: LoopGuardState, url: string, call: ToolCall): string | null {
  if (call.name === 'scroll') {
    state.scrollRun = state.scrollRun.url === url
      ? { url, count: state.scrollRun.count + 1 }
      : { url, count: 1 };
    if (state.scrollRun.count > SCROLL_RUN_LIMIT) {
      return `Loop detected: ${state.scrollRun.count} scrolls in a row on ${url} without finding the content. It is probably not in the accessibility snapshot at all — often a widget inside an iframe. Stop scrolling: extract what is visible, open the underlying page directly, or look for the data on another site.`;
    }
    return null;
  }

  state.scrollRun = { url: '', count: 0 };

  const ref = typeof call.arguments.ref === 'string' ? call.arguments.ref : '';
  const target = call.name === 'navigate' || call.name === 'open_tab'
    ? String(call.arguments.url ?? '')
    : ref;
  const key = `${url}|${call.name}|${target}`;
  const count = (state.visits[key] ?? 0) + 1;
  state.visits[key] = count;

  if (count > REVISIT_LIMIT) {
    const label = target ? `${call.name}(${target})` : call.name;
    return `Loop detected: ${label} has already been tried ${count - 1} times on this page and did not get you closer. Revisiting it again will not help — extract the evidence you already have, or take a different route entirely.`;
  }
  return null;
}

export function isLoopGuardEligible(call: ToolCall): boolean {
  return call.name !== 'done' && call.name !== 'set_task_plan';
}

export function toolCallSignature(call: ToolCall): string {
  return `${call.name}:${stableStringify(call.arguments)}`;
}

export function detectLoopGuardCycle(state: LoopGuardState, nextSignature: string): LoopGuardDecision {
  const sequence = [...state.noEffectSignatures, nextSignature];
  const maxCycleLength = Math.min(MAX_CYCLE_LENGTH, Math.floor(sequence.length / 2));

  for (let cycleLength = 1; cycleLength <= maxCycleLength; cycleLength++) {
    const noEffectActions = cycleLength === 1 ? 3 : cycleLength * 2;
    if (sequence.length < noEffectActions) continue;

    const suffix = sequence.slice(-noEffectActions);
    const pattern = suffix.slice(0, cycleLength);
    const repeats = suffix.every((signature, index) => signature === pattern[index % cycleLength]);
    if (repeats) {
      return { blocked: true, cycleLength, noEffectActions };
    }
  }

  return { blocked: false, cycleLength: 0, noEffectActions: 0 };
}

export function recordLoopGuardOutcome(
  state: LoopGuardState,
  signature: string,
  changedPage: boolean,
): void {
  if (changedPage) {
    state.noEffectSignatures = [];
    return;
  }

  state.noEffectSignatures.push(signature);
  if (state.noEffectSignatures.length > LOOP_GUARD_WINDOW) {
    state.noEffectSignatures.splice(0, state.noEffectSignatures.length - LOOP_GUARD_WINDOW);
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }

  return JSON.stringify(value) ?? String(value);
}
