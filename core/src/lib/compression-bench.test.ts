import { describe, expect, it } from 'vitest';
import { formatSnapshot } from './a11y';
import type { A11ySnapshot } from './types';
import type { OllamaMessage } from './ollama-client';
import {
  collapseOldObservations,
  contextTokenBudget,
  foldBoundary,
  historyTokens,
  pruneObservationRefs,
  snapshotSummary,
  trackObservation,
  type ObservationRef,
} from './context-compression';

// A realistic-sized accessibility snapshot: ~90 interactive nodes + ~25 visible text lines,
// which is what formatSnapshot produces for an average content page (≈3–6 KB of text).
function realisticSnapshot(step: number): A11ySnapshot {
  const nodes = Array.from({ length: 90 }, (_, i) => ({
    ref: `@e${i}`,
    role: i % 5 === 0 ? 'link' : i % 3 === 0 ? 'button' : 'textbox',
    name: `Control ${i} on page step ${step} with a fairly descriptive accessible name`,
    href: i % 5 === 0 ? `https://example.com/section/${i}?ref=step${step}` : undefined,
    value: i % 3 === 0 ? `value-${i}-${step}` : undefined,
    state: i % 7 === 0 ? ['focusable', 'visible'] : undefined,
    bbox: { x: i * 3, y: i * 11, w: 120, h: 24 },
  }));
  const textSnippets = Array.from(
    { length: 25 },
    (_, i) => `Paragraph ${i}: lorem ipsum dolor sit amet consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore (step ${step}).`,
  );
  return {
    url: `https://example.com/page/${step}`,
    title: `Example page — step ${step}`,
    viewport: { w: 1280, h: 800, scrollX: 0, scrollY: step * 50 },
    nodes,
    textSnippets,
  } as A11ySnapshot;
}

function pushStep(history: OllamaMessage[], refs: ObservationRef[], step: number): void {
  const snap = realisticSnapshot(step);
  const obs: OllamaMessage = { role: 'user', content: `[OBSERVATION]\n${formatSnapshot(snap)}` };
  history.push(obs);
  trackObservation(refs, obs, snapshotSummary(snap));
  history.push({
    role: 'assistant',
    content: '',
    tool_calls: [{ function: { name: 'click', arguments: { ref: `@e${step}` } } }],
  });
  history.push({ role: 'tool', content: 'ok', tool_call_id: `call_${step}` });
  history.push({ role: 'user', content: 'Action accepted. Continue with the next required browser action.' });
}

// Deterministic #1+#2 (the model-free part of enforceContextBudget).
function compress(history: OllamaMessage[], refs: ObservationRef[], budget: number): void {
  collapseOldObservations(refs);
  if (historyTokens(history) <= budget) return;
  const cut = foldBoundary(history, refs);
  if (cut < 0) return;
  const system = history.find((m) => m.role === 'system') ?? history[0];
  history.splice(0, cut, system, { role: 'user', content: '[EARLIER PROGRESS — folded]\nGOAL + recent steps digest.' });
  pruneObservationRefs(history, refs);
}

describe('compression bench (long task, realistic snapshots)', () => {
  it('keeps peak context bounded vs no compression', () => {
    const STEPS = 40;
    const NUM_CTX = 8192; // local model context window (ollama-client)
    const budget = contextTokenBudget({ provider: 'ollama' } as never);

    const offHist: OllamaMessage[] = [{ role: 'system', content: 'SYSTEM PROMPT ' + 'x'.repeat(4000) }];
    const offRefs: ObservationRef[] = [];
    const onHist: OllamaMessage[] = [{ role: 'system', content: 'SYSTEM PROMPT ' + 'x'.repeat(4000) }];
    const onRefs: ObservationRef[] = [];

    let offPeak = 0;
    let onPeak = 0;
    const rows: string[] = [];
    for (let step = 1; step <= STEPS; step++) {
      pushStep(offHist, offRefs, step);
      pushStep(onHist, onRefs, step);
      compress(onHist, onRefs, budget);

      const off = historyTokens(offHist);
      const on = historyTokens(onHist);
      offPeak = Math.max(offPeak, off);
      onPeak = Math.max(onPeak, on);
      if (step % 5 === 0 || step === 1) {
        rows.push(`  step ${String(step).padStart(2)} | off ${String(off).padStart(7)} tok | on ${String(on).padStart(6)} tok | ${off > NUM_CTX ? 'OFF OVERFLOWS num_ctx' : ''}`);
      }
    }

    const perStepSnapshot = historyTokens([{ role: 'user', content: `[OBSERVATION]\n${formatSnapshot(realisticSnapshot(1))}` }]);
    const reduction = Math.round((1 - onPeak / offPeak) * 100);

    console.log(
      [
        '',
        `Per-snapshot size:        ~${perStepSnapshot} tokens`,
        `num_ctx (local model):     ${NUM_CTX} tokens`,
        `compression budget:        ${budget} tokens`,
        '',
        `Peak context  OFF:         ${offPeak} tokens  (${(offPeak / NUM_CTX).toFixed(1)}× num_ctx — would not fit)`,
        `Peak context  ON (#1+#2):  ${onPeak} tokens  (${(onPeak / NUM_CTX).toFixed(2)}× num_ctx)`,
        `Peak token reduction:      ${reduction}%`,
        '',
        'Trace (sampled):',
        ...rows,
        '',
      ].join('\n'),
    );

    // The whole point: ON stays within the model window, OFF blows past it.
    expect(onPeak).toBeLessThan(NUM_CTX);
    expect(offPeak).toBeGreaterThan(NUM_CTX);
    expect(reduction).toBeGreaterThan(50);
  });
});
