import { describe, expect, it } from 'vitest';
import { addOpenedTabsToResult, findOpenedTabs, shouldFollowOpenedTab, type BrowserTabSummary } from './tab-sync';

function tab(tabId: number, url = `https://example.com/${tabId}`): BrowserTabSummary {
  return {
    tabId,
    windowId: 1,
    index: tabId,
    title: `Tab ${tabId}`,
    url,
    active: false,
    pinned: false,
    groupId: -1,
  };
}

describe('tab sync', () => {
  it('detects tabs created after an action', () => {
    const opened = findOpenedTabs([tab(1), tab(2)], [tab(1), tab(2), tab(3)]);

    expect(opened.map((item) => item.tabId)).toEqual([3]);
  });

  it('follows a single tab opened by a click side effect', () => {
    const opened = [tab(7, 'https://news.example/article')];

    expect(shouldFollowOpenedTab('click', opened)?.tabId).toBe(7);
  });

  it('does not auto-follow explicit open_tab because that tool manages its own target', () => {
    const opened = [tab(7, 'https://news.example/article')];

    expect(shouldFollowOpenedTab('open_tab', opened)).toBeUndefined();
  });

  it('adds opened tab metadata without dropping existing extracted data', () => {
    const result = addOpenedTabsToResult(
      { ok: true, durationMs: 0, extracted: { value: 'ok' } },
      [tab(7, 'https://news.example/article')],
    );

    expect(result.extracted).toEqual({
      value: 'ok',
      openedTabs: [{
        tabId: 7,
        title: 'Tab 7',
        url: 'https://news.example/article',
        active: false,
        windowId: 1,
        index: 7,
      }],
    });
  });
});
