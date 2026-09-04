import { describe, expect, it } from 'vitest';
import { compactHistoryForResume, describeBudgetPressure } from './agent-loop';
import { SWEEP_STEP_BUDGET } from '@/lib/step-budget';
import type { AgentStep, AgentTask } from '@/lib/types';

const START = 1_000_000;
const NO_DEADLINE = 0;

function extractStep(index: number, extracted: unknown): AgentStep {
  return {
    id: `s${index}`,
    index,
    status: 'ok',
    startedAt: 0,
    toolCall: { name: 'extract', arguments: {} },
    result: { ok: true, durationMs: 1, extracted },
    snapshot: { url: 'https://mail.example/inbox' },
  } as AgentStep;
}

function task(steps: AgentStep[]): AgentTask {
  return {
    id: 't1',
    goal: 'проверь почту за 5 дней',
    status: 'running',
    createdAt: START,
    updatedAt: START,
    tabId: 1,
    steps,
  } as AgentTask;
}

describe('describeBudgetPressure with a per-task budget', () => {
  it('does not warn a sweep at the base budget’s cut-off', () => {
    // Step 55 is the last stretch of a 60-step task and the middle of a 120-step sweep.
    expect(describeBudgetPressure(55, 3, START, NO_DEADLINE, START + 1_000, SWEEP_STEP_BUDGET)).toBeNull();
  });

  it('warns a sweep near its own cut-off', () => {
    const message = describeBudgetPressure(115, 3, START, NO_DEADLINE, START + 1_000, SWEEP_STEP_BUDGET);
    expect(message).toContain('[BUDGET]');
    expect(message).toContain('5 step(s)');
  });
});

describe('compactHistoryForResume', () => {
  it('carries the collected findings across the reset', () => {
    // The whole conversation is discarded here. Without the ledger the run also loses every
    // value it extracted and starts the sweep from page one.
    const history = compactHistoryForResume(
      [{ role: 'system', content: 'SYSTEM' }],
      task([extractStep(0, [{ text: 'Ivan — invoice — Mon' }])]),
      null,
      null,
      1,
      3,
      SWEEP_STEP_BUDGET,
      4000,
    );

    const carried = history.map((m) => m.content).join('\n');
    expect(carried).toContain('[COLLECTED SO FAR');
    expect(carried).toContain('Ivan — invoice — Mon');
    expect(carried).toContain(`Reached ${SWEEP_STEP_BUDGET} steps`);
  });

  it('says nothing about findings when the run collected none', () => {
    const history = compactHistoryForResume(
      [{ role: 'system', content: 'SYSTEM' }],
      task([]),
      null,
      null,
      1,
      3,
      SWEEP_STEP_BUDGET,
      4000,
    );

    expect(history.map((m) => m.content).join('\n')).not.toContain('[COLLECTED SO FAR');
  });
});
