import { describe, expect, it } from 'vitest';
import { parseDecomposition } from './orchestrator';

describe('orchestrator decomposition', () => {
  it('does not infer blocking subtasks from arbitrary reasoning or page text', () => {
    const result = parseDecomposition(
      `The user wants a spelling answer.
The visible text on this page is:
1. acknowledgment
2. Preferred spelling: acknowledgment
3. Variant: acknowledgement is also used.`,
      'check the dictionary spelling',
    );

    expect(result.subtasks).toHaveLength(1);
    expect(result.subtasks[0].description).toBe('check the dictionary spelling');
  });

  it('parses only explicitly marked orchestrator subtasks', () => {
    const result = parseDecomposition(
      `I need to split this long task.

ORCHESTRATOR SUBTASKS:
1. Collect prices from the first product page
2. Collect review counts from the comparison page
3. Verify and rank the final product list

Notes:
Do not treat this note as a subtask.`,
      'rank products',
    );

    expect(result.subtasks.map((subtask) => subtask.description)).toEqual([
      'Collect prices from the first product page',
      'Collect review counts from the comparison page',
      'Verify and rank the final product list',
    ]);
  });
});
