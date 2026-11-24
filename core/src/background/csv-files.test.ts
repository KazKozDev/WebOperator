import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentTask } from '@/lib/types';
import { runCsvTool } from './csv-files';

const download = { id: 7, state: 'complete', exists: true, filename: '/Users/me/Downloads/orders.csv', fileSize: 120, startTime: '2026-11-24T08:00:00Z' };
const artifact = { name: 'orders-filtered-abc.csv', path: '/Users/me/Downloads/orders-filtered-abc.csv', sha256: 'a'.repeat(64), inputRows: 3, outputRows: 2, columnCount: 4 };
const transform = { name: 'transform_csv' as const, arguments: { downloadId: 7, filters: [{ column: 'country', value: 'Spain' }] } };

describe('CSV tools', () => {
  const search = vi.fn();
  beforeEach(() => {
    search.mockReset().mockImplementation(async (query: { id?: number }) => query.id === undefined || query.id === 7 ? [download] : []);
    vi.stubGlobal('chrome', { downloads: { search } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists completed CSV downloads without the bridge', async () => {
    const result = await runCsvTool({} as AgentTask, { name: 'inspect_csv', arguments: {} });
    expect(result).toEqual({ downloads: [{ downloadId: 7, name: 'orders.csv', bytes: 120, startedAt: download.startTime }] });
  });

  it('registers the verified output once as a task attachment and passes only Chrome-resolved paths', async () => {
    const task = {} as AgentTask;
    const host = vi.fn().mockResolvedValue(artifact);
    const first = await runCsvTool(task, transform, host);
    const second = await runCsvTool(task, transform, host);
    expect(host).toHaveBeenCalledWith(expect.objectContaining({ mode: 'transform', file: download.filename }));
    expect(first).toMatchObject({ outputRows: 2, verified: true });
    expect(second.attachmentId).toBe(first.attachmentId);
    expect(task.attachments).toEqual([{ id: first.attachmentId, path: artifact.path, name: artifact.name, sha256: artifact.sha256, mimeType: 'text/csv' }]);
  });

  it('rejects unknown downloads, a missing bridge and a malformed bridge answer', async () => {
    const host = vi.fn().mockResolvedValue({ ...artifact, sha256: 'nope' });
    await expect(runCsvTool({} as AgentTask, { ...transform, arguments: { downloadId: 99 } }, host)).rejects.toThrow('not found');
    await expect(runCsvTool({} as AgentTask, { ...transform, arguments: { downloadId: '7' } }, host)).rejects.toThrow('downloadId');
    await expect(runCsvTool({} as AgentTask, transform)).rejects.toThrow('native bridge');
    await expect(runCsvTool({} as AgentTask, transform, host)).rejects.toThrow('invalid artifact');
  });
});
