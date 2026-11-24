import { fenceUntrusted, newFenceNonce } from '@/lib/injection-guard';
import type { AgentTask, ToolCall } from '@/lib/types';
import type { NativeHost } from './native-host';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SPREADSHEET = /\.xlsx$/i;

async function sourcePath(task: AgentTask, args: Record<string, unknown>): Promise<string> {
  if (typeof args.attachmentId === 'string' && args.attachmentId) {
    const attachment = task.attachments?.find(item => item.id === args.attachmentId);
    if (!attachment || !SPREADSHEET.test(attachment.path)) throw new Error(`No spreadsheet attachment ${args.attachmentId}`);
    return attachment.path;
  }
  const downloadId = args.downloadId;
  if (typeof downloadId !== 'number' || !Number.isSafeInteger(downloadId) || downloadId < 0) {
    throw new Error('Pass downloadId from numbers_read without arguments, or an attachmentId');
  }
  const [item] = await chrome.downloads.search({ id: downloadId });
  if (!item || item.state !== 'complete' || item.exists === false || !SPREADSHEET.test(item.filename)) throw new Error('Completed spreadsheet download not found');
  return item.filename;
}

export async function runNumbersTool(task: AgentTask, call: ToolCall, host?: NativeHost): Promise<unknown> {
  const args = call.arguments;
  if (call.name === 'numbers_read' && args.downloadId === undefined && args.attachmentId === undefined) {
    const items = await chrome.downloads.search({ state: 'complete', filenameRegex: '\\.[xX][lL][sS][xX]$', orderBy: ['-startTime'], limit: 30 });
    return { downloads: items.filter(item => item.exists !== false).map(item => ({
      downloadId: item.id, name: item.filename.split(/[/\\]/).pop(), bytes: item.fileSize, startedAt: item.startTime,
    })) };
  }
  if (!host) throw new Error('Numbers tools require the WebOperator native bridge on macOS');
  const file = await sourcePath(task, args);
  if (call.name === 'numbers_read') {
    const result = await host({ op: 'read', file, sheet: args.sheet, table: args.table, maxRows: args.maxRows });
    return { sheets: result.sheets, values: fenceUntrusted(JSON.stringify(result.values), newFenceNonce()) };
  }
  const cells = typeof args.cells === 'string' ? JSON.parse(args.cells) : args.cells;
  const result = await host({ op: 'edit', file, cells });
  const { path, name, sha256, edited } = result;
  if (typeof path !== 'string' || typeof name !== 'string' || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256) || result.verified !== true) {
    throw new Error('Numbers returned an unverified file');
  }
  const attachments = task.attachments ??= [];
  const existing = attachments.find(item => item.sha256 === sha256 && item.path === path);
  const id = existing?.id ?? `xlsx-${crypto.randomUUID()}`;
  if (!existing) attachments.push({ id, path, name, sha256, mimeType: XLSX_MIME });
  return { attachmentId: id, name, edited, verified: true };
}
