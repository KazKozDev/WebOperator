import { describe, expect, it } from 'vitest';
import { assessPageHealth, describePageTransition, leftWorkingOrigin } from './page-state';
import type { A11ySnapshot } from './types';

function snapshot(overrides: Partial<A11ySnapshot> = {}): A11ySnapshot {
  return {
    url: 'https://mail.google.com/mail/u/0/#search/newer_than%3A3d',
    title: 'Inbox',
    viewport: { w: 1280, h: 720, scrollX: 0, scrollY: 0 },
    nodes: [{ ref: '@e1', role: 'link', name: 'Invoice', bbox: { x: 0, y: 0, w: 10, h: 10 }, inViewport: true }],
    domHash: 'hash',
    takenAt: 1,
    ...overrides,
  };
}

const interstitial = snapshot({
  url: 'https://accounts.google.com/RotateCookiesPage',
  title: '',
  viewport: { w: 0, h: 0, scrollX: 0, scrollY: 0 },
  nodes: [],
  textSnippets: [],
});

describe('assessPageHealth', () => {
  it('marks a page with nodes as usable', () => {
    expect(assessPageHealth(snapshot()).blank).toBe(false);
  });

  it('marks a node-less, text-less page as blank with a collapsed viewport', () => {
    expect(assessPageHealth(interstitial)).toEqual({ blank: true, viewportCollapsed: true });
  });

  it('does not call a page blank while it still exposes text', () => {
    expect(assessPageHealth(snapshot({ nodes: [], textSnippets: ['Verifying...'] })).blank).toBe(false);
  });
});

describe('describePageTransition', () => {
  it('stays silent on a usable page', () => {
    expect(describePageTransition(snapshot(), null)).toBeNull();
  });

  it('names the recovery target the task should return to', () => {
    const hint = describePageTransition(interstitial, { url: 'https://mail.google.com/mail/u/0/', title: 'Inbox' });

    expect(hint).toContain('exposes no accessibility nodes');
    expect(hint).toContain('0x0 viewport');
    expect(hint).toContain('navigate back to https://mail.google.com/mail/u/0/');
    expect(hint).toContain('the page the task was working on');
    expect(hint).toContain('left the origin the task was working on');
  });

  it('falls back to waiting when there is no known good page', () => {
    const hint = describePageTransition(interstitial, null);

    expect(hint).toContain('wait for the page to finish loading');
  });
});

describe('leftWorkingOrigin', () => {
  it('detects a cross-origin drift', () => {
    expect(leftWorkingOrigin('https://accounts.google.com/RotateCookiesPage', { url: 'https://mail.google.com/mail', title: '' })).toBe(true);
    expect(leftWorkingOrigin('https://mail.google.com/mail/u/0/', { url: 'https://mail.google.com/mail', title: '' })).toBe(false);
  });
});
