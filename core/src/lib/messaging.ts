import type { CSMessage, CSResponse, SWEvent, SWMessage } from './types';
import type { AgentPortHost } from './port-channel';

const localEventListeners = new Set<(evt: SWEvent) => void>();
let globalPortHost: AgentPortHost | null = null;

export function registerPortHost(host: AgentPortHost): void {
  globalPortHost = host;
}

export async function sendToSW<R>(msg: SWMessage): Promise<R> {
  const res = await chrome.runtime.sendMessage(msg) as R | { error?: string };
  if (res && typeof res === 'object' && 'error' in res && typeof res.error === 'string') {
    throw new Error(res.error);
  }
  return res as R;
}

/**
 * Send to one frame of a tab — the main document by default.
 *
 * The frameId matters: `chrome.tabs.sendMessage` without one delivers to every frame and
 * resolves with whichever replies first. The content script runs in all of them, so on a page
 * with hidden service iframes (Google's cookie-rotation frame, a gapi hovercard widget) a
 * 0x0 iframe answers before the real document and the caller gets that frame's URL, viewport
 * and empty node list instead of the page's.
 */
export async function sendToContent(tabId: number, msg: CSMessage, frameId = 0): Promise<CSResponse> {
  try {
    return await chrome.tabs.sendMessage(tabId, msg, { frameId }) as CSResponse;
  } catch (err) {
    if (!isMissingReceiverError(err)) throw err;
    await ensureContentScript(tabId);
    return chrome.tabs.sendMessage(tabId, msg, { frameId }) as Promise<CSResponse>;
  }
}

export function onSWEvent(cb: (evt: SWEvent) => void): () => void {
  const handler = (msg: unknown) => {
    if (msg && typeof msg === 'object' && 'kind' in (msg as Record<string, unknown>)) {
      cb(msg as SWEvent);
    }
  };
  chrome.runtime.onMessage.addListener(handler);
  return () => chrome.runtime.onMessage.removeListener(handler);
}

export function broadcastEvent(evt: SWEvent): void {
  for (const listener of localEventListeners) {
    try { listener(evt); } catch {}
  }
  if (globalPortHost) {
    try { globalPortHost.broadcastEvent(evt); } catch {}
  }
  chrome.runtime.sendMessage(evt).catch(() => {});
}

export function onLocalSWEvent(cb: (evt: SWEvent) => void): () => void {
  localEventListeners.add(cb);
  return () => localEventListeners.delete(cb);
}


export async function ensureContentScript(tabId: number): Promise<void> {
  if (await canReachContentScript(tabId)) return;

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['assets/content-script.ts-loader.js'],
  });

  const started = Date.now();
  while (Date.now() - started < 10_000) {
    if (await canReachContentScript(tabId)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error('Content script injected, but did not become ready in this tab. Reload the page and try again.');
}

async function canReachContentScript(tabId: number): Promise<boolean> {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { kind: 'ping' });
    return Boolean(res && typeof res === 'object' && 'kind' in res && res.kind === 'ok');
  } catch {
    return false;
  }
}


function isMissingReceiverError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('Receiving end does not exist') || message.includes('Could not establish connection');
}
