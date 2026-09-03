import { beforeEach, describe, expect, it, vi } from 'vitest';

import { attachmentIdFor, stageAttachment } from './attachment-staging';

describe('attachmentIdFor', () => {
  it('slugifies the file name without its extension', () => {
    expect(attachmentIdFor('My CV 2026.pdf', new Set())).toBe('my-cv-2026');
  });

  it('keeps ids unique', () => {
    expect(attachmentIdFor('cv.pdf', new Set(['cv']))).toBe('cv-2');
  });
});

describe('stageAttachment', () => {
  beforeEach(() => {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:staged');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it('returns the on-disk path Chrome reports for the copied file', async () => {
    const download = vi.fn(async () => 7);
    const search = vi.fn(async () => [{ id: 7, state: 'complete', filename: '/Users/me/Downloads/weboperator-attachments/cv.pdf' }]);
    vi.stubGlobal('chrome', { downloads: { download, search } });

    const file = new File(['x'], 'cv.pdf', { type: 'application/pdf' });
    const attachment = await stageAttachment(file);

    expect(attachment).toEqual({
      id: 'cv',
      name: 'cv.pdf',
      path: '/Users/me/Downloads/weboperator-attachments/cv.pdf',
      mimeType: 'application/pdf',
    });
    expect(download).toHaveBeenCalledWith(expect.objectContaining({ filename: 'weboperator-attachments/cv.pdf', saveAs: false }));
  });

  it('surfaces an interrupted copy as an error', async () => {
    vi.stubGlobal('chrome', {
      downloads: {
        download: vi.fn(async () => 8),
        search: vi.fn(async () => [{ id: 8, state: 'interrupted', error: 'FILE_NO_SPACE' }]),
      },
    });

    await expect(stageAttachment(new File(['x'], 'cv.pdf'))).rejects.toThrow('FILE_NO_SPACE');
  });
});
