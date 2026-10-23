import { acquireCdp } from './cdp-session';
import { boundedNumber } from './bridge-browser';

export async function cookiesRequest(tabId: number, type: string, payload: Record<string, unknown>) {
  const release = await acquireCdp(tabId);
  try {
    if (type === 'cookies.get') {
      const url = String(payload.url ?? (await chrome.tabs.get(tabId)).url ?? '');
      if (!payload.domain && !/^https?:/.test(url)) throw new Error('cookies_get requires an HTTP(S) URL or domain');
      const result = await chrome.debugger.sendCommand({ tabId }, payload.domain ? 'Network.getAllCookies' : 'Network.getCookies', payload.domain ? {} : { urls: [url] }) as { cookies: Record<string, any>[] };
      const domain = String(payload.domain ?? '').replace(/^\./, '').toLowerCase();
      return { cookies: result.cookies.filter((item) => !domain || item.domain.replace(/^\./, '').toLowerCase() === domain || item.domain.replace(/^\./, '').toLowerCase().endsWith(`.${domain}`)) };
    }
    if (typeof payload.url !== 'string' || !/^https?:/.test(payload.url) || typeof payload.name !== 'string' || typeof payload.value !== 'string') throw new Error('cookies_set requires HTTP(S) url, name and value');
    const allowed = ['url', 'name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'sameSite', 'expires'];
    const params = Object.fromEntries(allowed.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]));
    const result = await chrome.debugger.sendCommand({ tabId }, 'Network.setCookie', params) as { success: boolean };
    if (!result.success) throw new Error('Chrome rejected the cookie');
    return { ok: true };
  } finally { await release(); }
}

export async function downloadsRequest(type: string, payload: Record<string, unknown>) {
  if (type === 'downloads.list') {
    const limit = boundedNumber(payload.limit, 20, 1, 500);
    const sinceMs = boundedNumber(payload.sinceMs, 600000, 0, Number.MAX_SAFE_INTEGER);
    const items = await chrome.downloads.search({ startedAfter: new Date(Date.now() - sinceMs).toISOString(), orderBy: ['-startTime'], limit });
    return { items: items.map((item) => ({ id: item.id, filename: item.filename, url: item.url, bytes: item.bytesReceived, state: item.state, mime: item.mime })) };
  }
  if (type === 'downloads.read') {
    const id = boundedNumber(payload.downloadId, 0, 1, Number.MAX_SAFE_INTEGER);
    const [item] = await chrome.downloads.search({ id });
    if (!item || item.state !== 'complete' || item.exists === false) throw new Error('Completed download not found');
    return { path: item.filename, state: item.state, mime: item.mime };
  }
  if (typeof payload.url !== 'string' || !/^(https?:|data:|blob:)/.test(payload.url)) throw new Error('Download URL must use HTTP(S), data or blob');
  if (payload.filename !== undefined && (typeof payload.filename !== 'string' || payload.filename.startsWith('/') || payload.filename.split(/[\\/]/).includes('..'))) throw new Error('filename must be a relative download path without parent traversal');
  const timeoutMs = boundedNumber(payload.timeoutMs, 120000, 1, 300000);
  const id = await chrome.downloads.download({ url: payload.url, ...(payload.filename ? { filename: String(payload.filename) } : {}), saveAs: payload.saveAs === true });
  const start = Date.now();
  do {
    const [item] = await chrome.downloads.search({ id });
    if (!item) throw new Error('Download disappeared');
    if (item.state === 'interrupted') throw new Error(`Download interrupted: ${item.error ?? 'unknown error'}`);
    if (item.state === 'complete') return { downloadId: id, path: item.filename, bytes: item.bytesReceived, state: item.state };
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (Date.now() - start < timeoutMs);
  const [pending] = await chrome.downloads.search({ id });
  return { downloadId: id, path: pending?.filename || undefined, bytes: pending?.bytesReceived ?? 0, state: pending?.state ?? 'unknown', requiresUserAction: !pending?.filename, warning: `Download did not finish within ${timeoutMs}ms; browser settings may require a Save dialog` };
}
