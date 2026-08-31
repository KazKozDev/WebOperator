import type { A11ySnapshot } from './types';

/**
 * A tab can navigate out from under a running task — an auth redirect, a cookie-rotation
 * bounce, an interstitial — and what comes back is a page with no accessibility tree and a
 * collapsed viewport. Nothing in a snapshot says "this is not your page", so the loop keeps
 * extracting and scrolling against an empty document until the loop guard trips. These helpers
 * name that state so the loop can wait it out or go back instead.
 */

export interface PageHealth {
  /** No accessibility nodes and no text — nothing here can be acted on or read. */
  blank: boolean;
  /** Viewport reported as zero-sized: the document is not laid out yet. */
  viewportCollapsed: boolean;
}

export interface RecoveryPage {
  url: string;
  title: string;
}

export function assessPageHealth(snapshot: A11ySnapshot): PageHealth {
  const hasText = (snapshot.textSnippets ?? []).some((snippet) => snippet.trim().length > 0);
  return {
    blank: snapshot.nodes.length === 0 && !hasText,
    viewportCollapsed: snapshot.viewport.w === 0 || snapshot.viewport.h === 0,
  };
}

/**
 * The message handed to the model when it is standing on a page it cannot work with. Returns
 * null while the page is usable.
 */
export function describePageTransition(
  snapshot: A11ySnapshot,
  target: RecoveryPage | null,
): string | null {
  const health = assessPageHealth(snapshot);
  if (!health.blank) return null;

  const viewport = health.viewportCollapsed ? ' and reports a 0x0 viewport' : '';
  const drifted = leftWorkingOrigin(snapshot.url, target)
    ? ' The tab has also left the origin the task was working on, so this is a redirect rather than a slow load.'
    : '';
  const lines = [
    `[PAGE IN TRANSITION] ${snapshot.url} exposes no accessibility nodes${viewport}. This is a redirect, an interstitial, or a page that has not finished loading — not the page the task was working on.${drifted}`,
    'extract, scroll and click cannot return anything here, and repeating them will not change that.',
  ];

  if (target && target.url !== snapshot.url) {
    lines.push(`Recover first: navigate back to ${target.url}${target.title ? ` ("${target.title}")` : ''} — the page the task was working on — and redo the step there.`);
  } else {
    lines.push('Recover first: wait for the page to finish loading, then re-read the snapshot before acting.');
  }

  return lines.join('\n');
}

/** True when the tab has drifted to a different origin than the page the task was working on. */
export function leftWorkingOrigin(currentUrl: string, target: RecoveryPage | null): boolean {
  if (!target) return false;
  return originOf(currentUrl) !== originOf(target.url);
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}
