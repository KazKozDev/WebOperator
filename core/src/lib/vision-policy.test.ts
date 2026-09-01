import { describe, expect, it } from 'vitest';
import { shouldAttachScreenshot } from './vision-policy';
import { ERROR_PAGE_DOM_HASH_PREFIX } from './page-state';
import { DEFAULT_SETTINGS } from './types';
import type { A11ySnapshot } from './types';

function snapshot(overrides: Partial<A11ySnapshot>): A11ySnapshot {
  return {
    url: 'https://a.example/',
    title: 'A page',
    viewport: { w: 1280, h: 720, scrollX: 0, scrollY: 0 },
    nodes: [],
    textSnippets: [],
    domHash: 'abc123',
    takenAt: 0,
    ...overrides,
  };
}

describe('vision on an unreadable page', () => {
  it('spends no screenshot on a tab parked on the error page', () => {
    // The stand-in snapshot has no nodes, which would otherwise match the canvas/shadow-DOM rule
    // and photograph Chrome's error page — the same few words every time.
    const decision = shouldAttachScreenshot(
      snapshot({
        url: 'http://127.0.0.1:1/roster',
        viewport: { w: 0, h: 0, scrollX: 0, scrollY: 0 },
        domHash: `${ERROR_PAGE_DOM_HASH_PREFIX}http://127.0.0.1:1/roster`,
      }),
      DEFAULT_SETTINGS,
      { stepIndex: 3 },
    );

    expect(decision.attach).toBe(false);
    expect(decision.reason).toContain('error page');
  });

  it('still photographs a genuinely node-less page such as a canvas app', () => {
    expect(shouldAttachScreenshot(snapshot({}), DEFAULT_SETTINGS, { stepIndex: 3 }).attach).toBe(true);
  });

  it('skips vision when the accessibility tree is enough', () => {
    // Measured over 1077 recorded steps: only 14.4% attach a screenshot. The default path is
    // already the cheap one, and this pins that so it stays true.
    const decision = shouldAttachScreenshot(
      snapshot({ nodes: [{ ref: '@e1', role: 'heading', name: 'Invoice 88' }] as A11ySnapshot['nodes'] }),
      DEFAULT_SETTINGS,
      { stepIndex: 3 },
    );

    expect(decision.attach).toBe(false);
    expect(decision.reason).toBe('a11y sufficient');
  });
});
