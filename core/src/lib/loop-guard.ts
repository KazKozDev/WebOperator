import type { ToolCall } from './types';

const LOOP_GUARD_WINDOW = 8;
const MAX_CYCLE_LENGTH = 4;

export interface LoopGuardState {
  noEffectSignatures: string[];
}

export interface LoopGuardDecision {
  blocked: boolean;
  cycleLength: number;
  noEffectActions: number;
}

export function createLoopGuardState(): LoopGuardState {
  return { noEffectSignatures: [] };
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
