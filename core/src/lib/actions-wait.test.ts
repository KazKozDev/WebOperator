import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./a11y', () => ({ findElementByRef: vi.fn() }));
import { runAction } from './actions';
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('waits for a selector inserted later', async () => {
  const querySelector = vi.fn().mockReturnValue(null);
  vi.stubGlobal('document', { querySelector });
  const pending = runAction({ name: 'wait', arguments: { until: 'element', selector: '.ready', ms: 15000 } }, 16000);
  await vi.advanceTimersByTimeAsync(12000);
  querySelector.mockReturnValue({});
  await vi.advanceTimersByTimeAsync(150);
  expect(await pending).toMatchObject({ ok: true, extracted: { matched: '.ready' } });
});
it('reports timeout when text never appears', async () => {
  vi.stubGlobal('document', { body: { innerText: 'loading' } });
  const pending = runAction({ name: 'wait', arguments: { until: 'text', text: 'done', ms: 300 } }, 1000);
  await vi.advanceTimersByTimeAsync(300);
  expect(await pending).toMatchObject({ ok: false, error: expect.stringContaining('did not match') });
});
it('checks load state rather than treating a load timeout as success', async () => {
  vi.stubGlobal('document', { readyState: 'loading', body: {} });
  const pending = runAction({ name: 'wait', arguments: { until: 'load', ms: 300 } }, 1000);
  await vi.advanceTimersByTimeAsync(300);
  expect(await pending).toMatchObject({ ok: false });
});
