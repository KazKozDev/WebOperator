import type { ToolCall } from './types';

export interface ModelHints {
  needReasoning: boolean;
  needVision: boolean;
}

export function parseHints(call: ToolCall | undefined, thinking?: string): ModelHints {
  const bag: string[] = [];
  if (call) {
    for (const v of Object.values(call.arguments)) {
      if (typeof v === 'string') bag.push(v);
    }
  }
  if (thinking) bag.push(thinking);
  const joined = bag.join(' ');
  return {
    needReasoning: /\bNEED_REASONING\b/.test(joined),
    needVision: /\bNEED_VISION\b/.test(joined),
  };
}
