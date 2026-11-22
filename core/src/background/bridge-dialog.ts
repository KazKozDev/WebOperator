import { acquireCdp } from './cdp-session';

type Dialog = { type: string; message: string; url: string; defaultPrompt?: string };
type Watch = { pending?: Dialog; ready: Promise<void> };
const watches = new Map<number, Watch>();

async function watchDialogs(tabId: number): Promise<Watch> {
  const existing = watches.get(tabId);
  if (existing) { await existing.ready; return existing; }
  const state: Watch = { ready: Promise.resolve() };
  watches.set(tabId, state);
  const onEvent = (source: chrome.debugger.Debuggee, method: string, raw?: object) => {
    if (source.tabId !== tabId) return;
    if (method === 'Page.javascriptDialogOpening') {
      const dialog = raw as Dialog;
      state.pending = { type: dialog.type, message: dialog.message, url: dialog.url, defaultPrompt: dialog.defaultPrompt };
    } else if (method === 'Page.javascriptDialogClosed') state.pending = undefined;
  };
  const cleanup = (source: chrome.debugger.Debuggee) => {
    if (source.tabId !== tabId) return;
    chrome.debugger.onEvent.removeListener(onEvent);
    chrome.debugger.onDetach.removeListener(cleanup);
    if (watches.get(tabId) === state) watches.delete(tabId);
  };
  state.ready = (async () => {
    const release = await acquireCdp(tabId, true);
    chrome.debugger.onEvent.addListener(onEvent);
    chrome.debugger.onDetach.addListener(cleanup);
    try { await chrome.debugger.sendCommand({ tabId }, 'Page.enable'); }
    catch (error) { cleanup({ tabId }); await chrome.debugger.detach({ tabId }).catch(() => {}); throw error; }
    finally { await release(); }
  })();
  try { await state.ready; } catch (error) { cleanup({ tabId }); throw error; }
  return state;
}

export async function handleDialog(tabId: number, payload: Record<string, unknown>) {
  const action = payload.action;
  if (typeof action !== 'string' || !['status', 'accept', 'dismiss'].includes(action)) throw new Error('action must be status, accept or dismiss');
  if (payload.promptText !== undefined && (action !== 'accept' || typeof payload.promptText !== 'string' || payload.promptText.length > 10000)) throw new Error('promptText must be a string of at most 10000 characters and requires accept');
  const state = await watchDialogs(tabId);
  if (action === 'status') return { observing: true, dialog: state.pending ?? null };
  const dialog = state.pending;
  if (!dialog) throw new Error('No observed dialog; call status before triggering it');
  if (payload.promptText !== undefined && dialog.type !== 'prompt') throw new Error('promptText requires a prompt dialog');
  await chrome.debugger.sendCommand({ tabId }, 'Page.handleJavaScriptDialog', {
    accept: action === 'accept', ...(payload.promptText === undefined ? {} : { promptText: payload.promptText }),
  });
  if (state.pending === dialog) state.pending = undefined;
  return { ok: true, action, type: dialog.type };
}
