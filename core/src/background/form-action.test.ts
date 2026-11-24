import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { A11ySnapshot } from '@/lib/types';
import { matchesReopenedForm } from '@/lib/form-save';
import { observeFormAction } from './form-action';

const { sendToContent } = vi.hoisted(() => ({ sendToContent: vi.fn() }));
vi.mock('@/lib/messaging', () => ({ sendToContent }));
const click = { name: 'click' as const, arguments: { ref: '@save' } };
function snapshot(text = ''): A11ySnapshot {
  const shared = { bbox: { x: 0, y: 0, w: 10, h: 10 }, inViewport: true, formRef: '@form' };
  return { url: 'https://example.com/records/1', title: 'Record', viewport: { w: 100, h: 100, scrollX: 0, scrollY: 0 },
    takenAt: 1, domHash: text, documentStart: 1, nodes: [
      { ...shared, ref: '@save', role: 'button', name: 'Save' },
      { ...shared, ref: '@name', role: 'textbox', name: 'Title', value: 'Long title' },
    ], textSnippets: text ? [text] : [] };
}
describe('save observation', () => {
  beforeEach(() => { vi.useFakeTimers(); sendToContent.mockReset(); });
  afterEach(() => vi.useRealTimers());
  async function scenario(before: string, after: string[]) {
    sendToContent.mockResolvedValueOnce({ kind: 'save:context', snapshot: snapshot(before), ref: '@save', refPrefix: '' });
    for (const text of after) sendToContent.mockResolvedValueOnce({ kind: 'snapshot', snapshot: snapshot(text) });
    sendToContent.mockResolvedValue({ kind: 'snapshot', snapshot: snapshot(after.at(-1)) });
    const execute = vi.fn().mockResolvedValue({ ok: true, durationMs: 1 });
    const result = observeFormAction(1, 0, click, execute);
    await vi.runAllTimersAsync();
    expect(execute).toHaveBeenCalledTimes(1);
    return result;
  }
  it('accepts a delayed Saving → Saved transition even if Saved was previously visible', async () => {
    expect((await scenario('Saved', ['Saving…', 'Saved'])).save?.status).toBe('saved');
  });
  it('never resubmits an unconfirmed operation while polling', async () => {
    expect((await scenario('Saved', ['Saved'])).save?.status).toBe('unconfirmed');
  });
  it('reports an asynchronous rejection', async () => {
    expect(await scenario('', ['Saving…', 'Could not save'])).toMatchObject({ ok: false, save: { status: 'rejected' } });
  });
  it('requires a reopened record and exact field values to confirm a silent save', () => {
    const before = snapshot();
    expect(matchesReopenedForm(before, before, click.arguments)).toBe(false);
    const after = { ...snapshot(), documentStart: 2 };
    expect(matchesReopenedForm(before, after, click.arguments)).toBe(true);
    after.nodes[1].value = 'Long';
    expect(matchesReopenedForm(before, after, click.arguments)).toBe(false);
  });
});
