import { describe, expect, it } from 'vitest';
import { verify } from './verifier';
import type { A11ySnapshot } from './types';

function snapshot(overrides: Partial<A11ySnapshot> = {}): A11ySnapshot {
  return {
    url: 'https://example.com',
    title: 'Example',
    viewport: { w: 1280, h: 720, scrollX: 0, scrollY: 0 },
    nodes: [],
    domHash: 'same-dom',
    takenAt: 1,
    ...overrides,
  };
}

describe('verifier', () => {
  it('treats successful read-only extraction as success without DOM changes', () => {
    const result = verify(
      snapshot(),
      snapshot({ takenAt: 2 }),
      { ok: true, durationMs: 1, extracted: 'visible text' },
      'extract',
    );

    expect(result.status).toBe('success');
    expect(result.domChanged).toBe(false);
  });
});
