import { describe, expect, it } from 'vitest';
import { verify, verificationToPrompt, describeVerification } from './verifier';
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

  it('detects partial/ghost execution when click produces no DOM/URL changes', () => {
    const result = verify(
      snapshot(),
      snapshot({ takenAt: 2 }),
      { ok: true, durationMs: 1 },
      'click',
    );

    expect(result.status).toBe('partial');
    expect(result.domChanged).toBe(false);
    expect(result.urlChanged).toBe(false);
    expect(describeVerification(result)).toContain('Verification partial (no DOM/URL change)');

    const prompt = verificationToPrompt(result);
    expect(prompt).toContain('NO observable state or DOM change was detected');
  });

  it('detects success when DOM hash changes after action', () => {
    const result = verify(
      snapshot({ domHash: 'hash-1' }),
      snapshot({ domHash: 'hash-2', takenAt: 2 }),
      { ok: true, durationMs: 1 },
      'click',
    );

    expect(result.status).toBe('success');
    expect(result.domChanged).toBe(true);
    expect(verificationToPrompt(result)).toContain('Action confirmed');
  });
});

