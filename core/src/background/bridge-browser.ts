import { acquireCdp, cdpContexts } from './cdp-session';
import { frameIdFromRef } from '@/lib/frames';
import type { CSResponse, ToolCall } from '@/lib/types';
import { ensureContentScript } from '@/lib/messaging';

export function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Expected a number between ${min} and ${max}`);
  }
  return value;
}

type Context = { id: number; auxData?: { isDefault?: boolean } };
type Evaluation = {
  result: { type: string; value?: unknown; unserializableValue?: string; objectId?: string; description?: string };
  exceptionDetails?: { text: string; url?: string; lineNumber: number; columnNumber: number; exception?: { description?: string } };
};

export async function evaluateInTab(tabId: number, payload: Record<string, unknown>) {
  if (typeof payload.expression !== 'string' || !payload.expression.trim()) throw new Error('Missing expression');
  const timeout = boundedNumber(payload.timeoutMs, 10_000, 1, 120_000);
  const frameId = boundedNumber(payload.frameId, 0, 0, Number.MAX_SAFE_INTEGER);
  const target = { tabId };
  const contexts: Context[] = [];
  const onEvent = (source: chrome.debugger.Debuggee, method: string, params?: object) => {
    if (source.tabId === tabId && method === 'Runtime.executionContextCreated') contexts.push((params as { context: Context }).context);
  };
  let release: (() => Promise<void>) | undefined;
  let marker: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!chrome.debugger?.attach) throw new Error('Chrome debugger API is unavailable');
    release = await acquireCdp(tabId);
    chrome.debugger.onEvent.addListener(onEvent);
    await chrome.debugger.sendCommand(target, 'Runtime.enable');
    let contextId: number | undefined;
    if (frameId !== 0) {
      // Chrome frame ids and CDP frame ids differ; a temporary DOM marker identifies the exact document.
      marker = `data-weboperator-eval-${crypto.randomUUID()}`;
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: (key) => document.documentElement.setAttribute(key, ''), args: [marker] });
      for (const context of [...new Map([...cdpContexts(tabId), ...contexts].map((item) => [item.id, item])).values()].filter((item) => item.auxData?.isDefault)) {
        try {
          const probe = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
            expression: `document.documentElement.hasAttribute(${JSON.stringify(marker)})`, contextId: context.id, returnByValue: true,
          }) as Evaluation;
          if (probe.result.value === true) { contextId = context.id; break; }
        } catch { /* A frame can disappear between Runtime.enable and the probe. */ }
      }
      if (contextId === undefined) throw new Error(`Frame ${frameId} is unavailable to this debugger session (possibly a cross-process iframe)`);
    }
    const response = await Promise.race([chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: payload.expression, returnByValue: payload.returnByValue !== false,
      awaitPromise: payload.awaitPromise !== false, userGesture: true, timeout,
      ...(contextId === undefined ? {} : { contextId }),
    }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Evaluation timed out after ${timeout}ms`)), timeout); })]) as Evaluation;
    const exception = response.exceptionDetails;
    if (exception) return { ok: false, exception: { text: exception.exception?.description ?? exception.text, url: exception.url, line: exception.lineNumber + 1, column: exception.columnNumber + 1 } };
    return { ok: true, ...response.result };
  } catch (error) {
    return { ok: false, error: `Browser evaluation failed (check DevTools/debugger access): ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    if (timer) clearTimeout(timer);
    if (marker) await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: (key) => document.documentElement.removeAttribute(key), args: [marker] }).catch(() => {});
    if (release) {
      chrome.debugger.onEvent.removeListener(onEvent);
      await release();
    }
  }
}

async function waitForNetwork(tabId: number, timeoutMs: number, pollMs: number): Promise<boolean> {
  const target = { tabId };
  const pending = new Set<string>();
  let quietSince: number;
  let release: (() => Promise<void>) | undefined;
  const onEvent = (source: chrome.debugger.Debuggee, method: string, params?: object) => {
    if (source.tabId !== tabId) return;
    const id = (params as { requestId?: string } | undefined)?.requestId;
    if (!id) return;
    const wasBusy = pending.size >= 2;
    if (method === 'Network.requestWillBeSent') pending.add(id);
    if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') pending.delete(id);
    if (pending.size >= 2 || wasBusy) quietSince = Date.now();
  };
  try {
    if (!chrome.debugger?.attach) throw new Error('Debugger unavailable');
    release = await acquireCdp(tabId);
    chrome.debugger.onEvent.addListener(onEvent);
    await chrome.debugger.sendCommand(target, 'Network.enable');
    const deadline = Date.now() + timeoutMs;
    quietSince = Date.now();
    while (Date.now() < deadline) {
      if (pending.size >= 2) quietSince = Date.now();
      if (Date.now() - quietSince >= 500) return true;
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, deadline - Date.now())));
    }
    return false;
  } finally {
    if (release) {
      chrome.debugger.onEvent.removeListener(onEvent);
      await release();
    }
  }
}

export async function waitInTab(tabId: number, payload: Record<string, unknown>) {
  const started = Date.now();
  const timeoutMs = boundedNumber(payload.timeoutMs, 15_000, 0, 120_000);
  const pollMs = boundedNumber(payload.pollMs, 150, 10, 1000);
  const until = String(payload.until ?? 'load');
  const result = (ok: boolean, extra: Record<string, unknown> = {}) => ({ ok, elapsedMs: Date.now() - started, ...extra });
  if (until === 'url') {
    if (typeof payload.urlPattern !== 'string' || !payload.urlPattern) throw new Error('url wait requires urlPattern (URL substring)');
    do {
      if ((await chrome.tabs.get(tabId)).url?.includes(payload.urlPattern)) return result(true, { matched: payload.urlPattern });
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, timeoutMs - (Date.now() - started)))));
    } while (Date.now() - started < timeoutMs);
    return result(false, { error: `URL did not contain ${payload.urlPattern}` });
  }
  let fallback: string | undefined;
  if (until === 'network_idle') {
    try {
      const ok = await waitForNetwork(tabId, timeoutMs, pollMs);
      return result(ok, { ...(ok ? {} : { error: 'Network did not become idle within timeout' }), source: 'network' });
    } catch { fallback = 'Debugger unavailable; observed DOM quiet instead of network traffic'; }
  }
  if (!['element', 'text', 'load', 'timeout', 'network_idle'].includes(until)) throw new Error(`Unknown wait condition: ${until}`);
  const remaining = Math.max(0, timeoutMs - (Date.now() - started));
  const action: ToolCall = { name: 'wait', arguments: { ...payload, until, ms: remaining } };
  await ensureContentScript(tabId);
  const response = await chrome.tabs.sendMessage(tabId, { kind: 'action:run', action }, { frameId: typeof payload.frameId === 'number' ? payload.frameId : frameIdFromRef(String(payload.ref ?? '')) }) as CSResponse;
  if (response.kind !== 'action:result') throw new Error('Unexpected wait response');
  return result(response.result.ok, { ...(response.result.extracted as Record<string, unknown> | undefined), ...(response.result.error ? { error: response.result.error } : {}), ...(fallback ? { source: 'dom', warning: fallback } : {}) });
}

export async function runTabsRequest(type: string, payload: Record<string, unknown>) {
  if (type === 'tabs.list') {
    const tabs = await chrome.tabs.query({});
    return { tabs: await Promise.all(tabs.map(async (tab) => {
      let frameCount: number | undefined;
      try { frameCount = (await chrome.scripting.executeScript({ target: { tabId: tab.id!, allFrames: true }, func: () => document.readyState })).length; } catch { /* Browser-internal pages cannot be inspected. */ }
      return { tabId: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title, active: tab.active, status: tab.status, groupId: tab.groupId, frameCount };
    })) };
  }
  if (type === 'tabs.open') {
    if (typeof payload.url !== 'string' || !payload.url) throw new Error('Missing url');
    const tab = await chrome.tabs.create({ url: payload.url, active: payload.active !== false, ...(payload.windowId === undefined ? {} : { windowId: boundedNumber(payload.windowId, 0, 1, Number.MAX_SAFE_INTEGER) }) });
    return { tabId: tab.id };
  }
  if (type === 'tabs.activate') {
    const tabId = boundedNumber(payload.tabId, 0, 1, Number.MAX_SAFE_INTEGER);
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (!tab) throw new Error(`Tab not found: ${tabId}`);
    await chrome.windows.update(tab.windowId, { focused: true });
    return { ok: true };
  }
  if (!Array.isArray(payload.tabIds) || !payload.tabIds.length) throw new Error('tabIds must be a non-empty array');
  const ids = [...new Set(payload.tabIds.map((id) => boundedNumber(id, 0, 1, Number.MAX_SAFE_INTEGER)))];
  const closed: number[] = [];
  const errors: { tabId: number; error: string }[] = [];
  for (const tabId of ids) {
    try { await chrome.tabs.remove(tabId); closed.push(tabId); }
    catch (error) { errors.push({ tabId, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { closed, errors };
}
