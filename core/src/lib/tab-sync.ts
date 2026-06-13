import type { ActionResult, AgentActionName } from './types';

export type BrowserTabSummary = {
  tabId: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  active: boolean;
  pinned: boolean;
  groupId: number;
};

export function actionMayOpenTab(name: AgentActionName): boolean {
  return name === 'click' || name === 'type' || name === 'press' || name === 'open_tab';
}

export function findOpenedTabs(before: BrowserTabSummary[], after: BrowserTabSummary[]): BrowserTabSummary[] {
  const existing = new Set(before.map((tab) => tab.tabId));
  return after.filter((tab) => !existing.has(tab.tabId));
}

export function shouldFollowOpenedTab(actionName: AgentActionName, openedTabs: BrowserTabSummary[]): BrowserTabSummary | undefined {
  if (actionName === 'open_tab') return undefined;
  if (!actionMayOpenTab(actionName)) return undefined;
  return openedTabs.length === 1 ? openedTabs[0] : undefined;
}

export function addOpenedTabsToResult(result: ActionResult, openedTabs: BrowserTabSummary[]): ActionResult {
  if (openedTabs.length === 0) return result;
  const compactTabs = openedTabs.map(({ tabId, title, url, active, windowId, index }) => ({
    tabId,
    title,
    url,
    active,
    windowId,
    index,
  }));

  if (result.extracted && typeof result.extracted === 'object' && !Array.isArray(result.extracted)) {
    return {
      ...result,
      extracted: {
        ...result.extracted,
        openedTabs: compactTabs,
      },
    };
  }

  return {
    ...result,
    extracted: result.extracted === undefined
      ? { openedTabs: compactTabs }
      : { value: result.extracted, openedTabs: compactTabs },
  };
}
