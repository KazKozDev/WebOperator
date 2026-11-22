import { beforeEach, expect, it, vi } from 'vitest';
import { observationRequest } from './bridge-observation';
import { evaluateInTab } from './bridge-browser';
const listeners = new Set<(source: { tabId: number }, method: string, params?: object) => void>();
const detached = new Set<(source: { tabId: number }) => void>();
const send = vi.fn();
let nextTab = 0;
beforeEach(() => {
  vi.clearAllMocks();
  send.mockImplementation(async (_target, method, params) => method === 'Runtime.evaluate' && params.expression.includes('hasAttribute') ? { result: { type: 'boolean', value: true } } : method === 'Network.getResponseBody' ? { body: '{"price":12}', base64Encoded: false } : { result: { type: 'number', value: 2 } });
  vi.stubGlobal('chrome', { scripting: { executeScript: vi.fn().mockResolvedValue([]) }, debugger: { attach: vi.fn().mockResolvedValue(undefined), detach: vi.fn().mockResolvedValue(undefined), sendCommand: send, onEvent: { addListener: (listener: any) => listeners.add(listener), removeListener: (listener: any) => listeners.delete(listener) }, onDetach: { addListener: (listener: any) => detached.add(listener), removeListener: (listener: any) => detached.delete(listener) } } });
});
function emit(tabId: number, method: string, params: object) { for (const listener of listeners) listener({ tabId }, method, params); }
it('captures real event metadata/body and keeps the session while eval borrows it', async () => {
  const tabId = ++nextTab;
  await observationRequest(tabId, 'network.clear', {});
  emit(tabId, 'Network.requestWillBeSent', { requestId: 'r1', type: 'Fetch', wallTime: Date.now() / 1000, request: { url: 'https://example.com/api', method: 'GET' } });
  emit(tabId, 'Network.responseReceived', { requestId: 'r1', response: { status: 200, mimeType: 'application/json' } });
  emit(tabId, 'Network.loadingFinished', { requestId: 'r1', encodedDataLength: 12 });
  await Promise.resolve();
  expect(await observationRequest(tabId, 'network.get', { requestId: 'r1' })).toEqual({ body: '{"price":12}', base64: false, mimeType: 'application/json' });
  const result = await observationRequest(tabId, 'network.list', { urlPattern: '/api', type: 'fetch' });
  expect(result).toMatchObject({ requests: [{ requestId: 'r1', status: 200 }] });
  expect(await evaluateInTab(tabId, { expression: '1+1' })).toMatchObject({ value: 2 });
  emit(tabId, 'Runtime.executionContextCreated', { context: { id: 42, auxData: { isDefault: true } } });
  expect(await evaluateInTab(tabId, { expression: '1+1', frameId: 4 })).toMatchObject({ value: 2 });
  expect(send).toHaveBeenCalledWith({ tabId }, 'Runtime.evaluate', expect.objectContaining({ contextId: 42, expression: '1+1' }));
  expect(chrome.debugger.attach).toHaveBeenCalledOnce();
  expect(chrome.debugger.detach).not.toHaveBeenCalled();
  for (const listener of detached) listener({ tabId });
});
it('filters console events and refuses missing request bodies', async () => {
  const tabId = ++nextTab;
  await observationRequest(tabId, 'console.list', {});
  emit(tabId, 'Runtime.consoleAPICalled', { type: 'warning', timestamp: Date.now(), args: [{ value: 'warning text' }] });
  expect(await observationRequest(tabId, 'console.list', { level: 'warn' })).toMatchObject({ entries: [{ level: 'warn', text: 'warning text' }] });
  await expect(observationRequest(tabId, 'network.get', { requestId: 'missing' })).rejects.toThrow('Request not found');
  for (const listener of detached) listener({ tabId });
});
