import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./cdp-session', () => ({ acquireCdp: vi.fn().mockResolvedValue(vi.fn()) }));
import { downloadsRequest, cookiesRequest } from './bridge-io';
const search = vi.fn(), download = vi.fn(), sendCommand = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', { downloads: { search, download }, tabs: { get: vi.fn().mockResolvedValue({ url: 'https://example.com/' }) }, debugger: { sendCommand } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('downloads with saveAs:false and returns complete metadata', async () => {
  download.mockResolvedValue(42);
  search.mockResolvedValue([{ id: 42, filename: '/tmp/test.txt', state: 'complete', bytesReceived: 5 }]);
  expect(await downloadsRequest('browser.download', { url: 'https://example.com/file', filename: 'test.txt', saveAs: false })).toMatchObject({ downloadId: 42, path: '/tmp/test.txt', state: 'complete' });
  expect(download).toHaveBeenCalledWith(expect.objectContaining({ saveAs: false }));
});
it('returns a resumable download id when a Save dialog blocks completion', async () => {
  vi.useFakeTimers();
  download.mockResolvedValue(43);
  search.mockResolvedValue([{ id: 43, filename: '', state: 'in_progress', bytesReceived: 5 }]);
  const pending = downloadsRequest('browser.download', { url: 'https://example.com/file', timeoutMs: 200 });
  await vi.advanceTimersByTimeAsync(200);
  expect(await pending).toMatchObject({ downloadId: 43, requiresUserAction: true, state: 'in_progress' });
});
it('rejects traversal and requires completed download ids for native reads', async () => {
  await expect(downloadsRequest('browser.download', { url: 'https://example.com', filename: '../secret' })).rejects.toThrow('parent traversal');
  search.mockResolvedValue([{ state: 'in_progress' }]);
  await expect(downloadsRequest('downloads.read', { downloadId: 1 })).rejects.toThrow('Completed download not found');
});
it('reads scoped cookies and preserves HttpOnly', async () => {
  sendCommand.mockResolvedValue({ cookies: [{ name: 'cookie', value: 'value', domain: 'example.com', httpOnly: true }] });
  expect(await cookiesRequest(7, 'cookies.get', {})).toMatchObject({ cookies: [{ httpOnly: true }] });
  expect(sendCommand).toHaveBeenCalledWith({ tabId: 7 }, 'Network.getCookies', { urls: ['https://example.com/'] });
});
