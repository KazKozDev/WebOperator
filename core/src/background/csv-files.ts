import type { NativeHost } from './native-host';
import type { AgentTask, ToolCall } from '@/lib/types';

export type CsvHost = NativeHost;

export async function runCsvTool(task: AgentTask, call: ToolCall, host?: CsvHost) {
  const { downloadId, filters, updates, columns, separator } = call.arguments;
  const inspect = call.name === 'inspect_csv';
  if (inspect && downloadId === undefined) {
    const items = await chrome.downloads.search({ state: 'complete', filenameRegex: '\\.[cC][sS][vV]$', orderBy: ['-startTime'], limit: 30 });
    return { downloads: items.filter(item => item.exists !== false).map(item => ({
      downloadId: item.id, name: item.filename.split(/[/\\]/).pop(), bytes: item.fileSize, startedAt: item.startTime,
    })) };
  }
  if (typeof downloadId !== 'number' || !Number.isSafeInteger(downloadId) || downloadId < 0) throw new Error('Choose a downloadId from inspect_csv');
  const [item] = await chrome.downloads.search({ id: downloadId });
  if (!item || item.state !== 'complete' || item.exists === false || !/\.csv$/i.test(item.filename)) throw new Error('Completed CSV download not found');
  if (!host) throw new Error('CSV processing requires the WebOperator native bridge');
  const result = await host({ mode: inspect ? 'inspect' : 'transform', file: item.filename, filters, updates, columns, separator });
  if (inspect) return result;
  const { path, name, sha256, inputRows, outputRows, columnCount } = result;
  if (typeof name !== 'string' || typeof path !== 'string' || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error('CSV bridge returned an invalid artifact');
  const attachments = task.attachments ??= [];
  const existing = attachments.find(a => a.sha256 === sha256 && a.path === path);
  const id = existing?.id ?? `csv-${crypto.randomUUID()}`;
  if (!existing) attachments.push({ id, path, name, sha256, mimeType: 'text/csv' });
  return { attachmentId: id, name, inputRows, outputRows, columnCount, verified: true };
}
