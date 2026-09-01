import { describe, it, expect } from 'vitest';
import { buildPartialSummaryPrompt, buildTraceQuestionPrompt, collectWork, describeSufficiencyCheck, fallbackPartialSummary } from './partial-work';
import type { AgentStep, AgentTask } from './types';

function step(partial: Partial<AgentStep> & { index: number }): AgentStep {
  return {
    id: `s${partial.index}`,
    status: 'ok',
    startedAt: 0,
    ...partial,
  } as AgentStep;
}

function task(steps: AgentStep[], plan?: AgentTask['plan']): Pick<AgentTask, 'steps' | 'plan'> {
  return { steps, plan };
}

describe('collectWork', () => {
  it('keeps extraction results and drops pure navigation', () => {
    const work = collectWork(task([
      step({ index: 0, toolCall: { name: 'navigate', arguments: { url: 'https://a.example' } }, snapshot: { url: 'https://a.example' } as never }),
      step({ index: 1, toolCall: { name: 'extract', arguments: {} }, result: { ok: true, durationMs: 1, extracted: 'Price: 39 EUR' } }),
    ]));

    expect(work.evidence).toHaveLength(1);
    expect(work.evidence[0]).toMatchObject({ stepIndex: 1, tool: 'extract', text: 'Price: 39 EUR' });
    expect(work.visitedUrls).toEqual(['https://a.example']);
  });

  it('counts failed steps and records every distinct url once', () => {
    const work = collectWork(task([
      step({ index: 0, snapshot: { url: 'https://a.example' } as never }),
      step({ index: 1, snapshot: { url: 'https://a.example' } as never, status: 'fail', result: { ok: false, durationMs: 1, error: 'boom' } }),
      step({ index: 2, snapshot: { url: 'https://b.example' } as never }),
    ]));

    expect(work.visitedUrls).toEqual(['https://a.example', 'https://b.example']);
    expect(work.failedSteps).toBe(1);
    expect(work.stepsRun).toBe(3);
  });

  it('splits the plan into what finished and what did not', () => {
    const work = collectWork(task([], {
      goal: 'g',
      intent: 'i',
      createdAt: 0,
      updatedAt: 0,
      steps: [
        { id: 'p1', index: 0, description: 'Open the listing', status: 'done' },
        { id: 'p2', index: 1, description: 'Compare the prices', status: 'active' },
      ],
    } as never));

    expect(work.completedPlanSteps).toEqual(['Open the listing']);
    expect(work.remainingPlanSteps).toEqual(['Compare the prices']);
  });

  it('serializes structured results rather than dropping them', () => {
    const work = collectWork(task([
      step({ index: 0, toolCall: { name: 'extract', arguments: {} }, result: { ok: true, durationMs: 1, extracted: { rows: [1, 2] } } }),
    ]));

    expect(work.evidence[0].text).toBe('{"rows":[1,2]}');
  });

  it('keeps the most recent evidence when a long run overflows the budget', () => {
    const steps = Array.from({ length: 60 }, (_, i) => step({
      index: i,
      toolCall: { name: 'extract', arguments: {} },
      result: { ok: true, durationMs: 1, extracted: `item ${i}` },
    }));

    const work = collectWork(task(steps));

    expect(work.evidence).toHaveLength(40);
    expect(work.evidence[work.evidence.length - 1].text).toBe('item 59');
  });
});

describe('fallbackPartialSummary', () => {
  it('states plainly when nothing was collected', () => {
    const work = collectWork(task([step({ index: 0, toolCall: { name: 'click', arguments: {} } })]));
    const summary = fallbackPartialSummary('Find the price', work);

    expect(summary).toContain('nothing was extracted');
    expect(summary).toContain('Find the price');
  });

  it('lists the collected values and what the plan did not reach', () => {
    const work = collectWork(task(
      [step({ index: 0, toolCall: { name: 'extract', arguments: {} }, result: { ok: true, durationMs: 1, extracted: 'Price: 39 EUR' } })],
      { goal: 'g', intent: 'i', createdAt: 0, updatedAt: 0, steps: [{ id: 'p', index: 0, description: 'Check the second shop', status: 'active' }] } as never,
    ));
    const summary = fallbackPartialSummary('Compare prices', work);

    expect(summary).toContain('Price: 39 EUR');
    expect(summary).toContain('Not covered:');
    expect(summary).toContain('Check the second shop');
  });
});

describe('prompts', () => {
  it('tells the model not to finish the task in a partial summary', () => {
    const prompt = buildPartialSummaryPrompt('Compare prices', collectWork(task([])));

    expect(prompt).toContain('Do not continue the task');
    expect(prompt).toContain('Not covered');
  });

  it('confines a follow-up question to the collected evidence', () => {
    const work = collectWork(task([
      step({ index: 0, toolCall: { name: 'extract', arguments: {} }, snapshot: { url: 'https://shop.example' } as never, result: { ok: true, durationMs: 1, extracted: 'Price: 39 EUR' } }),
    ]));
    const prompt = buildTraceQuestionPrompt('Compare prices', work, 'Which shop was cheapest?');

    expect(prompt).toContain('Which shop was cheapest?');
    expect(prompt).toContain('Price: 39 EUR');
    expect(prompt).toContain('https://shop.example');
    expect(prompt).toContain('Never fill a gap with general knowledge.');
  });
});

describe('describeSufficiencyCheck', () => {
  const work = (evidence: number, urls: number): Parameters<typeof describeSufficiencyCheck>[0] => ({
    evidence: Array.from({ length: evidence }, (_, i) => ({ stepIndex: i + 1, tool: 'extract', text: 'x' })),
    visitedUrls: Array.from({ length: urls }, (_, i) => `https://a${i}.example`),
    completedPlanSteps: [],
    remainingPlanSteps: [],
    stepsRun: evidence,
    failedSteps: 0,
  });

  it('stays quiet until there is something worth weighing', () => {
    expect(describeSufficiencyCheck(work(0, 0))).toBeNull();
    expect(describeSufficiencyCheck(work(1, 1))).toBeNull();
  });

  it('asks whether the collected evidence already answers the goal', () => {
    // The gap this fills: on the 82-step AssistantBench run, one extract at step 5 already held
    // four of the five gold answers. Nothing in the loop ever asked whether that was enough.
    const message = describeSufficiencyCheck(work(3, 2));
    expect(message).toContain('3 finding(s) from 2 page(s)');
    expect(message).toContain('call done now');
    expect(message).toContain('do not re-read');
  });

  it('points at the most recent findings rather than listing everything', () => {
    // The evidence is already in the history; repeating it would spend tokens to say nothing new.
    const message = describeSufficiencyCheck(work(9, 3)) ?? '';
    expect(message).toContain('#6, #7, #8, #9');
    expect(message).not.toContain('#1');
  });
});
