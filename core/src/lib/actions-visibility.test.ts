import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { findElementByRef } = vi.hoisted(() => ({ findElementByRef: vi.fn() }));
vi.mock('./a11y', () => ({ findElementByRef }));
import { runAction } from './actions';

const rect = { width: 100, height: 30, top: 10, bottom: 40, left: 10, right: 110 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600, scrollY: 120, getComputedStyle: () => ({}) });
});
afterEach(() => vi.unstubAllGlobals());

it.each(['click', 'type'] as const)('%s rejects an element still hidden after scrolling', async (name) => {
  const el = { scrollIntoView: vi.fn(), hidden: true, getBoundingClientRect: () => rect, dispatchEvent: vi.fn() };
  findElementByRef.mockReturnValue(el);
  const result = await runAction({ name, arguments: { ref: '@e1', text: 'hello' } }, 1000);
  expect(result).toMatchObject({ ok: false, error: 'Element not visible after scroll' });
  expect(el.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));
  expect(el.dispatchEvent).not.toHaveBeenCalled();
});
it('checks geometry after scrolling so offscreen elements can become visible', async () => {
  let moved = false;
  const scrollIntoView = vi.fn(() => { moved = true; });
  findElementByRef.mockReturnValue({ scrollIntoView, getBoundingClientRect: () => moved ? rect : { ...rect, top: 2000, bottom: 2030 } });
  expect(await runAction({ name: 'scroll', arguments: { to: 'element', ref: '@e1', block: 'end' } }, 1000)).toMatchObject({ ok: true, extracted: { scrollY: 120 } });
  expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'end' }));
});
it('rejects targets outside the viewport and invalid alignment', async () => {
  findElementByRef.mockReturnValue({ scrollIntoView: vi.fn(), getBoundingClientRect: () => ({ ...rect, top: 2000, bottom: 2030 }) });
  expect(await runAction({ name: 'click', arguments: { ref: '@e1' } }, 1000)).toMatchObject({ error: 'Element not visible after scroll' });
  expect(await runAction({ name: 'scroll', arguments: { to: 'element', ref: '@e1', block: 'invalid' } }, 1000)).toMatchObject({ ok: false, error: 'Invalid scroll block: invalid' });
});
