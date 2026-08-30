import { describe, expect, it } from 'vitest';
import type { OllamaMessage } from './ollama-client';
import type { A11ySnapshot, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';
import {
  collapseOldObservations,
  contextTokenBudget,
  estimateTokens,
  foldBoundary,
  historyTokens,
  pruneObservationRefs,
  snapshotSummary,
  trackObservation,
  type ObservationRef,
} from './context-compression';

function snap(url: string, nodes = 3): A11ySnapshot {
  return {
    url,
    title: `Title ${url}`,
    viewport: { w: 800, h: 600, scrollX: 0, scrollY: 0 },
    nodes: Array.from({ length: nodes }, (_, i) => ({
      ref: `@e${i}`,
      role: 'button',
      name: `n${i}`,
      bbox: { x: 0, y: 0, w: 10, h: 10 },
    })),
  } as A11ySnapshot;
}

// Push a full step (observation + assistant tool-call + tool result + control) into history.
function pushStep(history: OllamaMessage[], refs: ObservationRef[], s: A11ySnapshot): void {
  const obs: OllamaMessage = { role: 'user', content: `OBSERVATION ${s.url} ${'x'.repeat(2000)}` };
  history.push(obs);
  trackObservation(refs, obs, snapshotSummary(s));
  history.push({ role: 'assistant', content: '', tool_calls: [{ function: { name: 'click', arguments: {} } }] });
  history.push({ role: 'tool', content: 'ok', tool_call_id: 'c1' });
  history.push({ role: 'user', content: 'Action accepted. Continue.' });
}

describe('context-compression', () => {
  it('estimates tokens and budgets by provider locality', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(contextTokenBudget({ ...DEFAULT_SETTINGS, provider: 'ollama' })).toBeLessThan(
      contextTokenBudget({ ...DEFAULT_SETTINGS, provider: 'deepseek' }),
    );
  });

  it('collapses all but the last N observations in place', () => {
    const history: OllamaMessage[] = [{ role: 'system', content: 'sys' }];
    const refs: ObservationRef[] = [];
    for (const u of ['a', 'b', 'c', 'd']) pushStep(history, refs, snap(u));

    const before = historyTokens(history);
    collapseOldObservations(refs, 2);

    // Oldest two collapsed to their one-line summary, last two untouched.
    expect(refs[0].collapsed).toBe(true);
    expect(refs[1].collapsed).toBe(true);
    expect(refs[2].collapsed).toBe(false);
    expect(refs[3].collapsed).toBe(false);
    expect(refs[0].msg.content).toBe(snapshotSummary(snap('a')));
    expect(historyTokens(history)).toBeLessThan(before);
  });

  it('fold boundary lands on a step start (observation message), keeping pairs intact', () => {
    const history: OllamaMessage[] = [{ role: 'system', content: 'sys' }];
    const refs: ObservationRef[] = [];
    for (const u of ['a', 'b', 'c', 'd']) pushStep(history, refs, snap(u));

    const cut = foldBoundary(history, refs, 2);
    // Keep last 2 steps → boundary is the observation message of step 'c'.
    expect(cut).toBeGreaterThan(1);
    expect(history[cut]).toBe(refs[2].msg);
    expect(history[cut].role).toBe('user');
  });

  it('returns -1 when there is nothing safe to fold', () => {
    const history: OllamaMessage[] = [{ role: 'system', content: 'sys' }];
    const refs: ObservationRef[] = [];
    pushStep(history, refs, snap('a'));
    expect(foldBoundary(history, refs, 2)).toBe(-1);
  });

  it('prunes observation refs that were folded out of history', () => {
    const history: OllamaMessage[] = [{ role: 'system', content: 'sys' }];
    const refs: ObservationRef[] = [];
    for (const u of ['a', 'b', 'c']) pushStep(history, refs, snap(u));

    const cut = foldBoundary(history, refs, 2);
    history.splice(0, cut, { role: 'system', content: 'sys' }, { role: 'user', content: 'summary' });
    pruneObservationRefs(history, refs);

    // Only the kept observations remain tracked.
    expect(refs.every((r) => history.includes(r.msg))).toBe(true);
    expect(refs.length).toBe(2);
  });

  it('snapshot summary carries title, url and element count', () => {
    expect(snapshotSummary(snap('https://x', 5))).toContain('https://x');
    expect(snapshotSummary(snap('https://x', 5))).toContain('5 elements');
  });

  it('budget respects settings type', () => {
    const s: Settings = { ...DEFAULT_SETTINGS, provider: 'mlx' };
    expect(contextTokenBudget(s)).toBe(6000);
  });
});
