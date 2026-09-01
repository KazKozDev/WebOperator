import { describe, expect, it } from 'vitest';
import { describeBudgetPressure } from './agent-loop';

const START = 1_000_000;
const NO_DEADLINE = 0;

describe('describeBudgetPressure', () => {
  it('says nothing while there is room to work', () => {
    expect(describeBudgetPressure(5, 0, START, NO_DEADLINE, START + 10_000)).toBeNull();
    expect(describeBudgetPressure(5, 0, START, 600_000, START + 10_000)).toBeNull();
  });

  it('warns as the clock runs out, when a deadline actually exists', () => {
    // Four of the sixteen reachable AssistantBench tasks ran out of time holding evidence that
    // would have scored partial credit, because nothing behaved differently near the deadline.
    const message = describeBudgetPressure(20, 0, START, 600_000, START + 540_000);
    expect(message).toContain('[BUDGET]');
    expect(message).toContain('call done now');
  });

  it('invents no deadline for a task that has none', () => {
    // A person's own task runs as long as it needs to; only a configured budget creates pressure.
    expect(describeBudgetPressure(20, 0, START, NO_DEADLINE, START + 86_400_000)).toBeNull();
  });

  it('warns on the last steps of the final resume', () => {
    expect(describeBudgetPressure(55, 3, START, NO_DEADLINE, START + 1_000)).toContain('[BUDGET]');
  });

  it('stays quiet near the step limit while resumes remain', () => {
    // Running out mid-pass is not fatal — the run is compacted and continues.
    expect(describeBudgetPressure(55, 0, START, NO_DEADLINE, START + 1_000)).toBeNull();
  });

  it('never reports a negative budget once the deadline has passed', () => {
    const message = describeBudgetPressure(20, 0, START, 600_000, START + 700_000);
    expect(message).toContain('about 0s');
  });
});
