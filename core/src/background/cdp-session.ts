// Short actions borrow the same attachment as persistent network/console observation.
type RuntimeContext = { id: number; auxData?: { isDefault?: boolean } };
type Session = { contexts: Map<number, RuntimeContext>; ready: Promise<void>; users: number; persistent: boolean; closed: boolean; closing?: Promise<void> };
const sessions = new Map<number, Session>();
let listening = false;

export async function acquireCdp(tabId: number, persistent = false): Promise<() => Promise<void>> {
  if (!chrome.debugger?.attach) throw new Error('Chrome debugger API is unavailable');
  if (!listening) {
    chrome.debugger.onDetach?.addListener((target) => { if (target.tabId !== undefined) { const session = sessions.get(target.tabId); if (session) session.closed = true; sessions.delete(target.tabId); } });
    chrome.debugger.onEvent.addListener((target, method, raw) => {
      if (target.tabId === undefined) return;
      const contexts = sessions.get(target.tabId)?.contexts;
      if (!contexts) return;
      const params = raw as { context?: RuntimeContext; executionContextId?: number } | undefined;
      if (method === 'Runtime.executionContextCreated' && params?.context) contexts.set(params.context.id, params.context);
      if (method === 'Runtime.executionContextsCleared') contexts.clear();
      if (method === 'Runtime.executionContextDestroyed' && params?.executionContextId !== undefined) contexts.delete(params.executionContextId);
    });
    listening = true;
  }
  let session = sessions.get(tabId);
  if (session?.closing) { await session.closing; return acquireCdp(tabId, persistent); }
  if (!session) {
    session = { contexts: new Map(), ready: chrome.debugger.attach({ tabId }, '1.3'), users: 0, persistent: false, closed: false };
    sessions.set(tabId, session);
  }
  const current = session;
  current.users++;
  try { await current.ready; }
  catch (error) { if (sessions.get(tabId) === current) sessions.delete(tabId); throw new Error(`Cannot attach debugger (close DevTools or another debugger): ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  current.persistent ||= persistent;
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    current.users--;
    if (!current.users && !current.persistent && !current.closed && sessions.get(tabId) === current) {
      current.closing = chrome.debugger.detach({ tabId }).catch(() => {});
      await current.closing;
      if (sessions.get(tabId) === current) sessions.delete(tabId);
    }
  };
}

export function cdpContexts(tabId: number): RuntimeContext[] { return [...(sessions.get(tabId)?.contexts.values() ?? [])]; }
