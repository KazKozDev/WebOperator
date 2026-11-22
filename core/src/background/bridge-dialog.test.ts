import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { acquire } = vi.hoisted(() => ({ acquire: vi.fn() }));
vi.mock('./cdp-session', () => ({ acquireCdp: acquire }));
import { handleDialog } from './bridge-dialog';

const events = new Set<(source: { tabId: number }, method: string, params?: object) => void>();
const detaches = new Set<(source: { tabId: number }) => void>();
const send = vi.fn();
const emit = (tabId: number, method: string, params?: object) => { for (const listener of events) listener({ tabId }, method, params); };
beforeEach(() => {
  vi.resetAllMocks();
  acquire.mockResolvedValue(vi.fn().mockResolvedValue(undefined));
  send.mockResolvedValue({});
  vi.stubGlobal('chrome', { debugger: {
    sendCommand: send, detach: vi.fn().mockResolvedValue(undefined),
    onEvent: { addListener: (listener: typeof events extends Set<infer T> ? T : never) => events.add(listener), removeListener: (listener: typeof events extends Set<infer T> ? T : never) => events.delete(listener) },
    onDetach: { addListener: (listener: typeof detaches extends Set<infer T> ? T : never) => detaches.add(listener), removeListener: (listener: typeof detaches extends Set<infer T> ? T : never) => detaches.delete(listener) },
  } });
});
afterEach(() => { for (const listener of [...detaches]) listener({ tabId: 7 }); events.clear(); detaches.clear(); vi.unstubAllGlobals(); });

it('starts watching without accepting anything and ignores other tabs', async () => {
  expect(await handleDialog(7, { action: 'status' })).toEqual({ observing: true, dialog: null });
  emit(8, 'Page.javascriptDialogOpening', { type: 'alert', message: 'other' });
  expect(await handleDialog(7, { action: 'status' })).toMatchObject({ dialog: null });
  expect(send).toHaveBeenCalledTimes(1);
});
it('returns prompt metadata and accepts explicit text', async () => {
  await handleDialog(7, { action: 'status' });
  emit(7, 'Page.javascriptDialogOpening', { type: 'prompt', message: 'Name?', url: 'https://example.com', defaultPrompt: 'old' });
  expect(await handleDialog(7, { action: 'status' })).toMatchObject({ dialog: { type: 'prompt', message: 'Name?' } });
  expect(await handleDialog(7, { action: 'accept', promptText: 'new' })).toMatchObject({ ok: true });
  expect(send).toHaveBeenLastCalledWith({ tabId: 7 }, 'Page.handleJavaScriptDialog', { accept: true, promptText: 'new' });
  await expect(handleDialog(7, { action: 'accept' })).rejects.toThrow('No observed dialog');
});
it('dismisses a confirm and clears externally closed dialogs', async () => {
  await handleDialog(7, { action: 'status' });
  emit(7, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'Continue?' });
  await expect(handleDialog(7, { action: 'accept', promptText: 'wrong' })).rejects.toThrow('prompt dialog');
  await handleDialog(7, { action: 'dismiss' });
  expect(send).toHaveBeenLastCalledWith({ tabId: 7 }, 'Page.handleJavaScriptDialog', { accept: false });
  emit(7, 'Page.javascriptDialogOpening', { type: 'alert' });
  emit(7, 'Page.javascriptDialogClosed');
  expect(await handleDialog(7, { action: 'status' })).toMatchObject({ dialog: null });
});
it('rejects malformed actions before attaching', async () => {
  for (const payload of [{}, { action: ['accept'] }, { action: 'dismiss', promptText: 'x' }, { action: 'accept', promptText: 1 }]) {
    await expect(handleDialog(7, payload)).rejects.toThrow();
  }
  expect(acquire).not.toHaveBeenCalled();
});
it('cleans up a failed Page.enable so a retry can attach again', async () => {
  send.mockRejectedValueOnce(new Error('unavailable'));
  await expect(handleDialog(7, { action: 'status' })).rejects.toThrow('unavailable');
  expect(events.size).toBe(0);
  expect(await handleDialog(7, { action: 'status' })).toMatchObject({ dialog: null });
});
