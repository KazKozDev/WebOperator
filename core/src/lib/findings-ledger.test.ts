import { describe, expect, it } from 'vitest';
import { buildLedger, collectFindings, ledgerCharBudget, renderFindingsBlock } from './findings-ledger';
import type { AgentStep, AgentTask } from './types';

function step(partial: Partial<AgentStep> & { index: number }): AgentStep {
  return {
    id: `s${partial.index}`,
    status: 'ok',
    startedAt: 0,
    ...partial,
  } as AgentStep;
}

function task(steps: AgentStep[]): Pick<AgentTask, 'steps'> {
  return { steps };
}

function extractStep(index: number, extracted: unknown, url = 'https://mail.example/inbox'): AgentStep {
  return step({
    index,
    toolCall: { name: 'extract', arguments: {} },
    result: { ok: true, durationMs: 1, extracted },
    snapshot: { url } as AgentStep['snapshot'],
  });
}

describe('collectFindings', () => {
  it('keeps extraction payloads and drops pure navigation', () => {
    const findings = collectFindings(task([
      step({ index: 0, toolCall: { name: 'click', arguments: {} }, result: { ok: true, durationMs: 1 } }),
      extractStep(1, [{ text: 'Ivan — invoice — Mon' }]),
    ]));

    expect(findings).toHaveLength(1);
    expect(findings[0].text).toContain('invoice');
    expect(findings[0].stepIndex).toBe(1);
  });

  it('drops a failed step and an empty payload', () => {
    const findings = collectFindings(task([
      step({
        index: 0,
        toolCall: { name: 'extract', arguments: {} },
        result: { ok: false, durationMs: 1, error: 'no refs' },
      }),
      extractStep(1, ''),
    ]));

    expect(findings).toHaveLength(0);
  });

  it('collapses a repeated payload into one entry', () => {
    // Re-reading the same list is the failure this ledger exists to stop; listing it twice
    // would make the ledger reinforce it.
    const findings = collectFindings(task([
      extractStep(0, [{ text: 'row A' }]),
      extractStep(1, [{ text: 'row A' }]),
      extractStep(2, [{ text: 'row B' }]),
    ]));

    expect(findings.map((f) => f.text)).toEqual([
      JSON.stringify([{ text: 'row A' }]),
      JSON.stringify([{ text: 'row B' }]),
    ]);
  });

  it('keeps a payload far longer than an end-of-run summary would', () => {
    // collectWork trims to 1200 chars for its summary; a message list is the whole list.
    const rows = Array.from({ length: 200 }, (_, i) => ({ text: `message ${i}` }));
    const [finding] = collectFindings(task([extractStep(0, rows)]));

    expect(finding.text.length).toBeGreaterThan(2000);
  });
});

describe('buildLedger', () => {
  it('keeps the most recent findings when the budget is tight', () => {
    const findings = collectFindings(task([
      extractStep(0, 'oldest'),
      extractStep(1, 'middle'),
      extractStep(2, 'newest'),
    ]));

    const ledger = buildLedger(findings, 80);
    expect(ledger.findings.map((f) => f.text)).toContain('newest');
    expect(ledger.findings.map((f) => f.text)).not.toContain('oldest');
    expect(ledger.omitted).toBeGreaterThan(0);
  });

  it('keeps at least one finding even when it alone overruns the budget', () => {
    const findings = collectFindings(task([extractStep(0, 'x'.repeat(500))]));
    expect(buildLedger(findings, 10).findings).toHaveLength(1);
  });
});

describe('renderFindingsBlock', () => {
  it('returns null when nothing was collected', () => {
    expect(renderFindingsBlock([], 4000)).toBeNull();
    expect(renderFindingsBlock(collectFindings(task([])), 4000)).toBeNull();
  });

  it('returns null when the provider cannot afford a ledger', () => {
    const findings = collectFindings(task([extractStep(0, 'something')]));
    expect(renderFindingsBlock(findings, 0)).toBeNull();
  });

  it('tells the model the findings are already collected', () => {
    const findings = collectFindings(task([extractStep(0, 'Ivan — invoice')]));
    const block = renderFindingsBlock(findings, 4000)!;

    expect(block).toContain('[COLLECTED SO FAR');
    expect(block).toContain('Ivan');
    expect(block).toMatch(/do not re-visit or re-extract/i);
  });

  it('turns a dropped finding into pressure to land the answer', () => {
    const findings = collectFindings(task([
      extractStep(0, 'a'.repeat(200)),
      extractStep(1, 'b'.repeat(200)),
    ]));
    const block = renderFindingsBlock(findings, 260)!;

    expect(block).toContain('older finding(s) no longer fit');
    expect(block).toMatch(/call done/i);
  });
});

describe('ledgerCharBudget', () => {
  it('scales with the provider context and stays capped', () => {
    // A local 6k-token budget must not have a ledger eat it; a cloud one is capped anyway.
    expect(ledgerCharBudget(6000)).toBe(3600);
    expect(ledgerCharBudget(24000)).toBe(6000);
    expect(ledgerCharBudget(0)).toBe(0);
  });
});
