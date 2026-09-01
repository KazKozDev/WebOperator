import type { CSMessage, CSResponse, SWEvent, SWMessage } from './types';
import type { AgentPortHost } from './port-channel';

const CONTENT_REPLY_TIMEOUT_MS = 30_000;

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
    return await withReplyTimeout(chrome.tabs.sendMessage(tabId, msg, { frameId }) as Promise<CSResponse>, msg);
  } catch (err) {
    if (!isMissingReceiverError(err)) throw err;
    await ensureContentScript(tabId);
    return withReplyTimeout(chrome.tabs.sendMessage(tabId, msg, { frameId }) as Promise<CSResponse>, msg);
  }
}

/**
 * `chrome.tabs.sendMessage` settles when the content script answers — and never, when it does
 * not. A missing receiver rejects, and `ensureContentScript` bounds that path, but a receiver
 * that is present and simply silent has nothing to reject: a page caught mid-transition, or a
 * non-HTML document such as a text/plain API response. One of those hung a whole benchmark run,
 * which sat on a single stalled snapshot for 314 of its 600 seconds and answered nothing.
 *
 * Generous on purpose — a big `extract` on a heavy page is legitimately slow — but finite, so a
 * stuck page costs one step instead of the task.
 */
function withReplyTimeout(pending: Promise<CSResponse>, msg: CSMessage): Promise<CSResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Content script did not answer "${msg.kind}" within ${CONTENT_REPLY_TIMEOUT_MS}ms`));
    }, CONTENT_REPLY_TIMEOUT_MS);

    pending.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
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
