import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentTask } from './types';

const { addVirtualFileSystem, createPdf, download } = vi.hoisted(() => ({
  addVirtualFileSystem: vi.fn(),
  createPdf: vi.fn(),
  download: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('pdfmake/build/pdfmake', () => ({
  default: { addVirtualFileSystem, createPdf },
}));

vi.mock('pdfmake/build/vfs_fonts', () => ({
  default: { 'Roboto-Regular.ttf': 'font-data' },
}));

import { downloadPdf } from './export';

const task: AgentTask = {
  id: '12345678-test-task',
  goal: 'Export this task',
  status: 'done',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
  tabId: 1,
  profile: 'fast',
  steps: [],
};

describe('downloadPdf', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('generates and downloads a real PDF file', async () => {
    createPdf.mockReturnValue({ download });

    await downloadPdf(task);

    expect(addVirtualFileSystem).toHaveBeenCalledTimes(1);
    expect(createPdf).toHaveBeenCalledWith(expect.objectContaining({
      pageSize: 'A4',
      content: expect.arrayContaining([
        expect.objectContaining({ text: 'Export this task' }),
      ]),
    }));
    expect(download).toHaveBeenCalledWith('report-12345678.pdf');
  });
});
