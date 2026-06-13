import { describe, expect, it } from 'vitest';
import { verify } from './verifier';
import type { A11yNode, A11ySnapshot } from './types';

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

function node(overrides: Partial<A11yNode> = {}): A11yNode {
  return {
    ref: '@e1',
    role: 'generic',
    name: '',
    bbox: { x: 0, y: 0, w: 10, h: 10 },
    inViewport: true,
    ...overrides,
  };
}

const okAction = { ok: true, durationMs: 1 };

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

  it('does not flag error words in pre-existing page text', () => {
    const articleSnippet = 'Common error handling mistakes developers make';
    const before = snapshot({ textSnippets: [articleSnippet] });
    const after = snapshot({
      domHash: 'new-dom',
      takenAt: 2,
      textSnippets: [articleSnippet],
    });

    const result = verify(before, after, okAction, 'click');

    expect(result.status).toBe('success');
    expect(result.errorDetected).toBeUndefined();
  });

  it('flags error text that appeared after the action', () => {
    const before = snapshot({ textSnippets: ['Sign in to continue'] });
    const after = snapshot({
      domHash: 'new-dom',
      takenAt: 2,
      textSnippets: ['Sign in to continue', 'Something went wrong, please try again'],
    });

    const result = verify(before, after, okAction, 'click');

    expect(result.status).toBe('failed');
    expect(result.errorDetected).toContain('something went wrong');
  });

  it('does not flag error words in headings that existed before the action', () => {
    const heading = node({ role: 'heading', name: 'Top 10 error messages explained' });
    const before = snapshot({ nodes: [heading] });
    const after = snapshot({ nodes: [heading], domHash: 'new-dom', takenAt: 2 });

    const result = verify(before, after, okAction, 'scroll');

    expect(result.errorDetected).toBeUndefined();
  });

  it('flags a new heading that looks like an error page', () => {
    const before = snapshot();
    const after = snapshot({
      domHash: 'new-dom',
      takenAt: 2,
      nodes: [node({ role: 'heading', name: 'Access denied' })],
    });

    const result = verify(before, after, okAction, 'navigate');

    expect(result.status).toBe('failed');
    expect(result.errorDetected).toContain('access denied');
  });

  it('flags HTTP error codes in the page title', () => {
    const result = verify(
      snapshot(),
      snapshot({ title: '503 Service Unavailable', domHash: 'new-dom', takenAt: 2 }),
      okAction,
      'navigate',
    );

    expect(result.status).toBe('failed');
    expect(result.errorDetected).toContain('503');
  });
});
