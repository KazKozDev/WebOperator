import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findElementByRef } = vi.hoisted(() => ({ findElementByRef: vi.fn() }));
vi.mock('./a11y', () => ({ findElementByRef }));

import { runAction } from './actions';

describe('batch action execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', {});
    vi.stubGlobal('MouseEvent', class {
      constructor(_type: string, _init: unknown) {}
    });
  });

  it('stops at the first failed child and reports per-action outcomes', async () => {
    const elements = new Map([
      ['@e1', { scrollIntoView: vi.fn(), dispatchEvent: vi.fn().mockReturnValue(true) }],
      ['@e2', { scrollIntoView: vi.fn(), dispatchEvent: vi.fn().mockReturnValue(false) }],
      ['@e3', { scrollIntoView: vi.fn(), dispatchEvent: vi.fn().mockReturnValue(true) }],
    ]);
    findElementByRef.mockImplementation((ref: string) => elements.get(ref));

    const result = await runAction({
      name: 'batch_actions',
      arguments: { actions: [
        { name: 'click', ref: '@e1' },
        { name: 'click', ref: '@e2' },
        { name: 'click', ref: '@e3' },
      ] },
    }, 1_000);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('action 2');
    expect(result.extracted).toEqual(expect.objectContaining({
      outcomes: [
        { index: 0, name: 'click', ok: true },
        { index: 1, name: 'click', ok: false, error: 'Click was cancelled by page' },
      ],
      stoppedAt: 2,
    }));
    expect(elements.get('@e3')?.dispatchEvent).not.toHaveBeenCalled();
  });
});
