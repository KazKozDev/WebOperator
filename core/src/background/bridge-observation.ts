import { acquireCdp } from './cdp-session';
import { boundedNumber } from './bridge-browser';

type Request = { requestId: string; url: string; method: string; type: string; status?: number; mimeType?: string; ts: number; size?: number; body?: string; base64?: boolean; bodyError?: string; finished?: boolean };
type Entry = { ts: number; level: string; text: string; url?: string; line?: number };
type Observer = { requests: Map<string, Request>; entries: Entry[]; pending: Set<string>; quietSince: number; ready: Promise<void>; attached: boolean };
const observers = new Map<number, Observer>();
const MAX_BODY = 5 * 1024 * 1024;
const MAX_TOTAL_BODY = 20 * 1024 * 1024;

async function observe(tabId: number): Promise<Observer> {
  const existing = observers.get(tabId);
  if (existing) { await existing.ready; return existing; }
  const state: Observer = { requests: new Map(), entries: [], pending: new Set(), quietSince: Date.now(), ready: Promise.resolve(), attached: true };
  observers.set(tabId, state);
  const onEvent = (source: chrome.debugger.Debuggee, method: string, raw?: object) => {
    if (source.tabId !== tabId) return;
    const p = raw as Record<string, any>;
    const id = String(p?.requestId ?? '');
    if (method === 'Network.requestWillBeSent') {
      const wasBusy = state.pending.size >= 2;
      state.pending.add(id);
      if (wasBusy || state.pending.size >= 2) state.quietSince = Date.now();
      const type = String(p.type).toLowerCase();
      if (['xhr', 'fetch', 'document'].includes(type)) {
        state.requests.set(id, { requestId: id, url: p.request.url, method: p.request.method, type, ts: (p.wallTime ?? Date.now() / 1000) * 1000 });
        while (state.requests.size > 500) state.requests.delete(state.requests.keys().next().value!);
      }
    }
    const request = state.requests.get(id);
    if (method === 'Network.responseReceived' && request) Object.assign(request, { status: p.response.status, mimeType: p.response.mimeType });
    if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
      const wasBusy = state.pending.size >= 2;
      state.pending.delete(id);
      if (wasBusy) state.quietSince = Date.now();
      if (request) {
        request.finished = true;
        request.size = p.encodedDataLength ?? 0;
        if (method === 'Network.loadingFailed') request.bodyError = p.errorText ?? 'Request failed';
        else if ((request.size ?? 0) > MAX_BODY) request.bodyError = 'Response exceeds 5 MiB';
        else void chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId: id }).then((result) => {
          const body = result as { body: string; base64Encoded: boolean };
          const bytes = body.base64Encoded ? Math.floor(body.body.length * 3 / 4) : new TextEncoder().encode(body.body).length;
          if (bytes > MAX_BODY) { request.bodyError = 'Response exceeds 5 MiB'; return; }
          request.body = body.body; request.base64 = body.base64Encoded;
          let total = [...state.requests.values()].reduce((sum, item) => sum + (item.body?.length ?? 0), 0);
          for (const item of state.requests.values()) {
            if (total <= MAX_TOTAL_BODY) break;
            total -= item.body?.length ?? 0;
            delete item.body; item.bodyError = 'Response body evicted from memory';
          }
        }).catch((error) => { request.bodyError = String(error); });
      }
    }
    let entry: Entry | undefined;
    if (method === 'Runtime.consoleAPICalled') {
      const frame = p.stackTrace?.callFrames?.[0];
      const levels: Record<string, string> = { warning: 'warn', error: 'error', assert: 'error', debug: 'log', info: 'log' };
      entry = { ts: p.timestamp ?? Date.now(), level: levels[p.type] ?? p.type, text: (p.args ?? []).map((arg: any) => String(arg.value ?? arg.description ?? arg.type)).join(' '), url: frame?.url, line: frame ? frame.lineNumber + 1 : undefined };
    } else if (method === 'Runtime.exceptionThrown') {
      const e = p.exceptionDetails;
      entry = { ts: p.timestamp ?? Date.now(), level: 'error', text: e.exception?.description ?? e.text, url: e.url, line: e.lineNumber + 1 };
    } else if (method === 'Log.entryAdded') entry = { ts: p.entry.timestamp, level: p.entry.level === 'warning' ? 'warn' : p.entry.level, text: p.entry.text, url: p.entry.url, line: p.entry.lineNumber === undefined ? undefined : p.entry.lineNumber + 1 };
    if (entry) { entry.text = entry.text.slice(0, 10000); state.entries.push(entry); if (state.entries.length > 500) state.entries.shift(); }
  };
  const onDetach = (source: chrome.debugger.Debuggee) => {
    if (source.tabId !== tabId) return;
    state.attached = false;
    chrome.debugger.onEvent.removeListener(onEvent);
    chrome.debugger.onDetach?.removeListener(onDetach);
    if (observers.get(tabId) === state) observers.delete(tabId);
  };
  state.ready = (async () => {
    const release = await acquireCdp(tabId, true);
    chrome.debugger.onEvent.addListener(onEvent);
    chrome.debugger.onDetach?.addListener(onDetach);
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable', { maxTotalBufferSize: MAX_TOTAL_BODY, maxResourceBufferSize: MAX_BODY });
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
      await chrome.debugger.sendCommand({ tabId }, 'Log.enable');
    } catch (error) { onDetach({ tabId }); await chrome.debugger.detach({ tabId }).catch(() => {}); throw error; }
    finally { await release(); }
  })();
  try { await state.ready; } catch (error) { observers.delete(tabId); throw error; }
  return state;
}

export async function observationRequest(tabId: number, type: string, payload: Record<string, unknown>) {
  const state = await observe(tabId);
  if (type === 'network.clear') { state.requests.clear(); return { ok: true, capturing: true }; }
  const sinceMs = boundedNumber(payload.sinceMs, 60_000, 0, Number.MAX_SAFE_INTEGER);
  const limit = boundedNumber(payload.limit, 100, 1, 500);
  if (type === 'console.list') return { entries: state.entries.filter((entry) => entry.ts >= Date.now() - sinceMs && (!payload.level || payload.level === 'all' || entry.level === payload.level)).slice(-limit), capturing: true };
  if (type === 'network.get') {
    const item = state.requests.get(String(payload.requestId ?? ''));
    if (!item) throw new Error('Request not found in this tab capture buffer');
    if (item.body === undefined) throw new Error(item.bodyError ?? 'Response body is not ready yet');
    return { body: item.body, base64: item.base64, mimeType: item.mimeType };
  }
  return { requests: [...state.requests.values()].filter((item) => item.ts >= Date.now() - sinceMs && (!payload.urlPattern || item.url.includes(String(payload.urlPattern))) && (!payload.type || item.type === String(payload.type).toLowerCase())).slice(-limit).map(({ body: _body, base64: _base64, ...item }) => item), capturing: true };
}

export async function waitForObservedNetwork(tabId: number, timeoutMs: number, pollMs: number): Promise<boolean> {
  const state = await observe(tabId);
  const start = Date.now();
  // Require a fresh quiet window even if no request has arrived since capture started.
  let quietSince = Math.max(state.quietSince, start);
  do {
    if (!state.attached) throw new Error('Debugger detached during network wait');
    quietSince = Math.max(quietSince, state.quietSince);
    if (state.pending.size >= 2) quietSince = Date.now();
    if (Date.now() - quietSince >= 500) return true;
    if (Date.now() - start >= timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, timeoutMs - (Date.now() - start))));
  } while (Date.now() - start <= timeoutMs);
  return false;
}

export function hasObservation(tabId: number): boolean { return observers.has(tabId); }
