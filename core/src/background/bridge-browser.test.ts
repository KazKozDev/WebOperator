import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/messaging', () => ({ ensureContentScript: vi.fn() }));
import { boundedNumber, evaluateInTab, runTabsRequest, waitInTab } from './bridge-browser';

let event: (source: { tabId: number }, method: string, params?: object) => void;
const debuggerApi = {
  attach: vi.fn(), detach: vi.fn(), sendCommand: vi.fn(),
  onEvent: { addListener: vi.fn((listener) => { event = listener; }), removeListener: vi.fn() },
};
const tabs = { get: vi.fn(), query: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), sendMessage: vi.fn() };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  debuggerApi.attach.mockResolvedValue(undefined);
  debuggerApi.detach.mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { debugger: debuggerApi, tabs, windows: { update: vi.fn() }, scripting: { executeScript: vi.fn().mockResolvedValue([{ frameId: 0 }]) } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('bridge browser primitives', () => {
  it('rejects invalid timeouts and identifiers', () => {
    for (const value of [NaN, Infinity, -1, '10', 1.5]) expect(() => boundedNumber(value, 10, 0, 100)).toThrow();
  });
  it('evaluates in the main world with options and always detaches', async () => {
    debuggerApi.sendCommand.mockResolvedValue({ result: { type: 'number', value: 2 } });
    expect(await evaluateInTab(7, { expression: '1+1' })).toEqual({ ok: true, type: 'number', value: 2 });
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith({ tabId: 7 }, 'Runtime.evaluate', expect.objectContaining({ expression: '1+1', awaitPromise: true, returnByValue: true, timeout: 10000 }));
    expect(debuggerApi.detach).toHaveBeenCalledWith({ tabId: 7 });
  });
  it('bounds unresolved promises and releases debugger access', async () => {
    debuggerApi.sendCommand.mockImplementation(async (_target, method) => {
      if (method === 'Runtime.evaluate') return new Promise(() => {});
      return {};
    });
    const pending = evaluateInTab(7, { expression: 'new Promise(() => {})', timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ ok: false, error: expect.stringContaining('timed out after 100ms') });
    expect(debuggerApi.detach).toHaveBeenCalledOnce();
  });
  it('reports JS exceptions and debugger attachment failures', async () => {
    debuggerApi.sendCommand.mockResolvedValue({ result: {}, exceptionDetails: { text: 'Uncaught', lineNumber: 0, columnNumber: 8, exception: { description: 'SyntaxError' } } });
    expect(await evaluateInTab(7, { expression: '(' })).toMatchObject({ ok: false, exception: { text: 'SyntaxError', line: 1, column: 9 } });
    debuggerApi.attach.mockRejectedValue(new Error('Another debugger is attached'));
    debuggerApi.detach.mockClear();
    expect(await evaluateInTab(7, { expression: '1' })).toMatchObject({ ok: false, error: expect.stringContaining('DevTools') });
    expect(debuggerApi.detach).not.toHaveBeenCalled();
  });
  it('waits for actual network quiet and ignores other tabs', async () => {
    const pending = waitInTab(7, { until: 'network_idle', timeoutMs: 2000, pollMs: 50 });
    await vi.advanceTimersByTimeAsync(0);
    event({ tabId: 7 }, 'Network.requestWillBeSent', { requestId: 'a' });
    event({ tabId: 7 }, 'Network.requestWillBeSent', { requestId: 'b' });
    await vi.advanceTimersByTimeAsync(700);
    event({ tabId: 8 }, 'Network.loadingFinished', { requestId: 'a' });
    await vi.advanceTimersByTimeAsync(100);
    event({ tabId: 7 }, 'Network.loadingFinished', { requestId: 'a' });
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toMatchObject({ ok: true, elapsedMs: 1300, source: 'network' });
    expect(debuggerApi.onEvent.removeListener).toHaveBeenCalledWith(event);
    expect(debuggerApi.detach).toHaveBeenCalledOnce();
  });
  it('fails on a busy network timeout instead of claiming success', async () => {
    const pending = waitInTab(7, { until: 'network_idle', timeoutMs: 600 });
    await vi.advanceTimersByTimeAsync(0);
    for (const requestId of ['a', 'b']) event({ tabId: 7 }, 'Network.requestWillBeSent', { requestId });
    await vi.advanceTimersByTimeAsync(600);
    expect(await pending).toMatchObject({ ok: false, source: 'network' });
  });
  it('labels the DOM fallback and routes refs to the owning frame', async () => {
    debuggerApi.attach.mockRejectedValue(new Error('Unavailable'));
    tabs.sendMessage.mockResolvedValue({ kind: 'action:result', result: { ok: true, extracted: { matched: 'dom_quiet' } } });
    expect(await waitInTab(7, { until: 'network_idle', ref: '@f3e2' })).toMatchObject({ ok: true, source: 'dom', warning: expect.any(String) });
    expect(tabs.sendMessage).toHaveBeenCalledWith(7, expect.any(Object), { frameId: 3 });
  });
  it('polls URL changes and reports a failed content wait', async () => {
    tabs.get.mockResolvedValueOnce({ url: 'https://example.com/' }).mockResolvedValue({ url: 'https://example.com/search' });
    const pending = waitInTab(7, { until: 'url', urlPattern: '/search' });
    await vi.advanceTimersByTimeAsync(150);
    expect(await pending).toMatchObject({ ok: true, matched: '/search' });
    tabs.sendMessage.mockResolvedValue({ kind: 'action:result', result: { ok: false, error: 'not found' } });
    expect(await waitInTab(7, { until: 'text', text: 'hello' })).toMatchObject({ ok: false, error: 'not found' });
  });
  it('keeps per-tab close failures and closes each id once', async () => {
    tabs.remove.mockImplementation(async (id) => { if (id === 8) throw new Error('gone'); });
    expect(await runTabsRequest('tabs.close', { tabIds: [7, 8, 7] })).toEqual({ closed: [7], errors: [{ tabId: 8, error: 'gone' }] });
    expect(tabs.remove).toHaveBeenCalledTimes(2);
  });
});
