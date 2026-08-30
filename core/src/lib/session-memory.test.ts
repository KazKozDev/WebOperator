import { describe, expect, it, vi } from 'vitest';
import { getRecentSessionContext } from './session-memory';
import * as storage from './storage';

describe('getRecentSessionContext', () => {
  it('returns formatted previous turns with user requests, answers, and extracted data', async () => {
    vi.spyOn(storage, 'listTasks').mockResolvedValue([
      {
        id: 'task-1',
        tabId: 101,
        goal: 'Find top 3 mechanical keyboards',
        status: 'done',
        createdAt: Date.now() - 5000,
        updatedAt: Date.now(),
        profile: 'fast',
        steps: [],
      },
    ]);

    vi.spyOn(storage, 'loadSteps').mockResolvedValue([
      {
        id: 'step-1',
        index: 1,
        status: 'ok',
        startedAt: 0,
        finishedAt: 1,
        toolCall: {
          name: 'extract',
          arguments: { refs: '@e1,@e2' },
        },
        result: {
          ok: true,
          durationMs: 120,
          extracted: 'Keychron Q1 ($170), NuPhy Air75 ($110)',
        },
      },
      {
        id: 'step-2',
        index: 2,
        status: 'ok',
        startedAt: 1,
        finishedAt: 2,
        toolCall: {
          name: 'done',
          arguments: {
            success: 'true',
            summary: 'Found 1. Keychron Q1, 2. NuPhy Air75',
          },
        },
      },
    ]);

    const ctx = await getRecentSessionContext(101, 'https://example.com/keyboards');
    expect(ctx).toContain('[PREVIOUS SESSION CONVERSATION & FINDINGS]');
    expect(ctx).toContain('User Request: "Find top 3 mechanical keyboards"');
    expect(ctx).toContain('Agent Findings / Answer: Found 1. Keychron Q1, 2. NuPhy Air75');
    expect(ctx).toContain('Extracted Data: Keychron Q1 ($170), NuPhy Air75 ($110)');
    expect(ctx).toContain('Current URL: https://example.com/keyboards');
  });

  it('returns empty string if no prior tasks exist for session', async () => {
    vi.spyOn(storage, 'listTasks').mockResolvedValue([]);
    const ctx = await getRecentSessionContext(999);
    expect(ctx).toBe('');
  });
});
