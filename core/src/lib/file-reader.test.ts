import { describe, expect, it, vi } from 'vitest';
import { listRecentDownloads, readLatestDownload } from './file-reader';

describe('file-reader', () => {
  it('handles missing chrome.downloads gracefully', async () => {
    vi.stubGlobal('chrome', {});
    const list = await listRecentDownloads();
    expect(list).toEqual([]);

    const res = await readLatestDownload();
    expect(res.ok).toBe(false);
    expect(res.error).toContain('chrome.downloads API is not available');
  });

  it('searches and reads latest downloaded file when chrome.downloads is available', async () => {
    vi.stubGlobal('chrome', {
      downloads: {
        search: vi.fn().mockResolvedValue([
          {
            id: 101,
            filename: '/Users/user/Downloads/report_2026.csv',
            url: 'data:text/csv;charset=utf-8,date,revenue%0A2026-08-01,15000%0A2026-08-02,18500',
            mime: 'text/csv',
            fileSize: 52,
            state: 'complete',
            startTime: '2026-08-29T08:00:00.000Z',
            danger: 'safe',
          },
        ]),
      },
    });

    const list = await listRecentDownloads();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(101);

    const res = await readLatestDownload();
    expect(res.ok).toBe(true);
    expect(res.filename).toBe('report_2026.csv');
    expect(res.content).toContain('2026-08-01,15000');
  });
});
