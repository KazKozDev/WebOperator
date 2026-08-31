import { describe, expect, it } from 'vitest';
import { AGENT_TOOLS, selectAgentTools } from './tools';

describe('tool palette benchmark', () => {
  it('cuts schema payload for a direct browser action by more than half', () => {
    const selected = selectAgentTools({
      goal: 'Click the account button',
      firstStep: true,
      snapshot: { url: 'https://example.com', nodes: [] },
    });
    const fullBytes = JSON.stringify(AGENT_TOOLS).length;
    const selectedBytes = JSON.stringify(selected).length;
    const reduction = 1 - selectedBytes / fullBytes;

    console.log(
      `Tool schemas: ${AGENT_TOOLS.length} -> ${selected.length}; ` +
      `${fullBytes} -> ${selectedBytes} chars (${Math.round(reduction * 100)}% reduction)`,
    );

    expect(selected.length).toBeLessThan(AGENT_TOOLS.length / 2);
    expect(reduction).toBeGreaterThan(0.5);
  });
});
