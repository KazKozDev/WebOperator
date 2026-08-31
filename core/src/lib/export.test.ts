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

import { buildPdfHtml, downloadPdf } from './export';

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

describe('stopped runs in the report', () => {
  it('renders the partial summary and labels it as partial', async () => {
    const html = buildPdfHtml({
      id: 't1',
      goal: 'Compare prices',
      tabId: 1,
      status: 'stopped',
      steps: [],
      createdAt: 0,
      updatedAt: 0,
      profile: 'balanced',
      partialSummary: 'Collected: one price, 39 EUR.',
    } as never);

    expect(html).toContain('Collected: one price, 39 EUR.');
    expect(html).toContain('Partial result');
    expect(html).toContain('Stopped');
  });
});
