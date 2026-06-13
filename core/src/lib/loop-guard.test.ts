import { describe, expect, it } from 'vitest';
import {
  createLoopGuardState,
  detectLoopGuardCycle,
  recordLoopGuardOutcome,
  toolCallSignature,
} from './loop-guard';
import type { ToolCall } from './types';

function call(name: ToolCall['name'], args: Record<string, unknown>): ToolCall {
  return { name, arguments: args };
}

function recordNoEffect(state: ReturnType<typeof createLoopGuardState>, toolCall: ToolCall): string {
  const signature = toolCallSignature(toolCall);
  recordLoopGuardOutcome(state, signature, false);
  return signature;
}

describe('loop guard', () => {
  it('blocks the third identical no-effect call', () => {
    const state = createLoopGuardState();
    const click = call('click', { ref: '@e1' });
    const signature = recordNoEffect(state, click);
    recordLoopGuardOutcome(state, signature, false);

    expect(detectLoopGuardCycle(state, signature)).toEqual({
      blocked: true,
      cycleLength: 1,
      noEffectActions: 3,
    });
  });

  it('blocks an alternating two-action no-effect cycle', () => {
    const state = createLoopGuardState();
    const clickA = call('click', { ref: '@e1' });
    const clickB = call('click', { ref: '@e2' });
    const signatureA = recordNoEffect(state, clickA);
    const signatureB = recordNoEffect(state, clickB);
    recordLoopGuardOutcome(state, signatureA, false);

    expect(detectLoopGuardCycle(state, signatureB)).toEqual({
      blocked: true,
      cycleLength: 2,
      noEffectActions: 4,
    });
  });

  it('blocks a three-action no-effect cycle', () => {
    const state = createLoopGuardState();
    const signatures = [
      recordNoEffect(state, call('click', { ref: '@e1' })),
      recordNoEffect(state, call('scroll', { direction: 'down' })),
      recordNoEffect(state, call('wait', { ms: 1000 })),
    ];
    for (const signature of signatures.slice(0, 2)) {
      recordLoopGuardOutcome(state, signature, false);
    }

    expect(detectLoopGuardCycle(state, signatures[2])).toEqual({
      blocked: true,
      cycleLength: 3,
      noEffectActions: 6,
    });
  });

  it('does not block non-repeating no-effect actions', () => {
    const state = createLoopGuardState();
    recordNoEffect(state, call('click', { ref: '@e1' }));
    recordNoEffect(state, call('click', { ref: '@e2' }));
    recordNoEffect(state, call('scroll', { direction: 'down' }));

    const decision = detectLoopGuardCycle(state, toolCallSignature(call('wait', { ms: 1000 })));

    expect(decision.blocked).toBe(false);
  });

  it('clears no-effect history after a successful page-changing action', () => {
    const state = createLoopGuardState();
    const signature = recordNoEffect(state, call('click', { ref: '@e1' }));
    recordLoopGuardOutcome(state, signature, false);
    recordLoopGuardOutcome(state, signature, true);

    expect(detectLoopGuardCycle(state, signature).blocked).toBe(false);
  });

  it('normalizes argument key order in signatures', () => {
    expect(toolCallSignature(call('type', { ref: '@e1', text: 'hello' })))
      .toBe(toolCallSignature(call('type', { text: 'hello', ref: '@e1' })));
  });
});
