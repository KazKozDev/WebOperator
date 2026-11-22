import { describe, expect, it } from 'vitest';
import type { AgentTask } from './types';
import { conversationAnswer, loadConversation, renderConversationContext } from './conversation';

function task(id: string, parentTaskId?: string): AgentTask {
  return { id, parentTaskId, goal: `Question ${id}`, status: 'done', tabId: 1, profile: 'balanced', createdAt: 0, updatedAt: 0, steps: [] };
}

describe('explicit chat continuity', () => {
  it('loads only linked turns, in order, across tabs and old sessions', async () => {
    const first = task('first');
    const second = { ...task('second', 'first'), tabId: 99 };
    const unrelated = task('unrelated');
    const tasks = [first, second, unrelated];
    expect(await loadConversation('second', async (id) => tasks.find((t) => t.id === id))).toEqual([first, second]);
    expect(await loadConversation(undefined, async () => unrelated)).toEqual([]);
  });

  it('includes the actual answer, extracted results and URLs for follow-up actions', () => {
    const previous = task('first');
    previous.steps = [
      { id: 'e', startedAt: 0, index: 0, status: 'ok', toolCall: { name: 'extract', arguments: {} }, result: { ok: true, durationMs: 0, extracted: { name: 'Camera A', price: 123, url: 'https://example.com/a' } } },
      { id: 'd', startedAt: 0, index: 1, status: 'ok', toolCall: { name: 'done', arguments: { summary: 'fallback' } }, result: { ok: true, durationMs: 0, extracted: 'Camera A is cheapest.' } },
    ];
    const prompt = renderConversationContext([previous], 10000);
    expect(prompt).toContain('Camera A is cheapest.');
    expect(prompt).toContain('https://example.com/a');
    expect(prompt).toContain('123');
    expect(prompt).toContain('Question first');
  });

  it('carries stopped-run summaries and prefers recent turns under a limited budget', () => {
    const previous = { ...task('stopped'), partialSummary: 'Found three products.' };
    expect(conversationAnswer(previous)).toBe('Found three products.');
    const prompt = renderConversationContext([task('old'), task('latest')], 70);
    expect(prompt).toContain('Question latest');
    expect(prompt).toContain('omitted or truncated');
    expect(renderConversationContext([], 100)).toBe('');
  });

  it('stops on cyclic links and reports missing history', async () => {
    expect(await loadConversation('loop', async () => task('loop', 'loop'))).toHaveLength(1);
    await expect(loadConversation('missing', async () => null)).rejects.toThrow('missing');
  });
});
