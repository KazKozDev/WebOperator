import type { CSMessage, CSResponse, SWEvent, SWMessage } from './types';

const localEventListeners = new Set<(evt: SWEvent) => void>();

export async function sendToSW<R>(msg: SWMessage): Promise<R> {
  const res = await chrome.runtime.sendMessage(msg) as R | { error?: string };
  if (res && typeof res === 'object' && 'error' in res && typeof res.error === 'string') {
    throw new Error(res.error);
  }
  return res as R;
}

export async function sendToContent(tabId: number, msg: CSMessage): Promise<CSResponse> {
  try {
    return await chrome.tabs.sendMessage(tabId, msg) as CSResponse;
  } catch (err) {
    if (!isMissingReceiverError(err)) throw err;
    await ensureContentScript(tabId);
    return chrome.tabs.sendMessage(tabId, msg) as Promise<CSResponse>;
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
    await chrome.tabs.sendMessage(tabId, { kind: 'snapshot:take' });
    return true;
  } catch {
    return false;
  }
}

function isMissingReceiverError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('Receiving end does not exist') || message.includes('Could not establish connection');
}
