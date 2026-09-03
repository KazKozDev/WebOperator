/**
 * Staging of side-panel file picks into task attachments.
 *
 * CDP's DOM.setFileInputFiles only accepts absolute on-disk paths, and a File picked in the
 * side panel never exposes one. So the pick is written into the Downloads folder first and the
 * path Chrome reports back becomes the attachment path the agent uploads later.
 */

import type { TaskAttachment } from './types';

export const ATTACHMENT_FOLDER = 'weboperator-attachments';
export const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;

function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'file';
}

/** Short, human-typable id the model repeats back in upload_attachment. */
export function attachmentIdFor(name: string, taken: ReadonlySet<string>): string {
  const base = slugify(name.replace(/\.[^.]+$/, '')).toLowerCase() || 'file';
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

async function waitForDownloadPath(downloadId: number, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [item] = await chrome.downloads.search({ id: downloadId });
    if (item?.state === 'complete' && item.filename) return item.filename;
    if (item?.state === 'interrupted') throw new Error(item.error ?? 'Chrome interrupted the file copy');
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error('Timed out while copying the file');
}

/**
 * Copies one picked file into the Downloads folder and returns the attachment record
 * (id + absolute path) that `task:start` hands to the agent.
 */
export async function stageAttachment(file: File, takenIds: ReadonlySet<string> = new Set()): Promise<TaskAttachment> {
  if (typeof chrome === 'undefined' || !chrome.downloads) {
    throw new Error('File attachments need the Chrome downloads permission');
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is larger than ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB`);
  }
  const url = URL.createObjectURL(file);
  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename: `${ATTACHMENT_FOLDER}/${slugify(file.name)}`,
      conflictAction: 'uniquify',
      saveAs: false,
    });
    const path = await waitForDownloadPath(downloadId);
    return {
      id: attachmentIdFor(file.name, takenIds),
      name: file.name,
      path,
      mimeType: file.type || undefined,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
