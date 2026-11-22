import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { findElementByRef } = vi.hoisted(() => ({ findElementByRef: vi.fn() }));
vi.mock('./a11y', () => ({ findElementByRef }));
import { runAction } from './actions';

class Select {
  value = '';
  disabled = false;
  hidden = false;
  options = [{ value: 'ES', textContent: 'Spain', disabled: false, parentElement: null }];
  scrollIntoView = vi.fn();
  dispatchEvent = vi.fn();
  getBoundingClientRect() { return { width: 100, height: 20, top: 10, left: 10, right: 110, bottom: 30 }; }
}
let select: Select;
beforeEach(() => {
  select = new Select();
  findElementByRef.mockReturnValue(select);
  vi.stubGlobal('document', { querySelector: vi.fn(() => select) });
  vi.stubGlobal('HTMLSelectElement', Select);
  vi.stubGlobal('HTMLOptGroupElement', class {});
  vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600, getComputedStyle: () => ({}) });
});
afterEach(() => vi.unstubAllGlobals());
it.each(['ES', 'Spain'])('selects by value or label and emits input/change: %s', async (value) => {
  const result = await runAction({ name: 'select', arguments: { ref: '@e1', value } }, 1000);
  expect(result.ok).toBe(true);
  expect(select.value).toBe('ES');
  expect(select.dispatchEvent.mock.calls.map(([event]) => event.type)).toEqual(['input', 'change']);
});
it('resolves an explicit CSS selector without requiring a snapshot ref', async () => {
  const result = await runAction({ name: 'select', arguments: { ref: '#country', value: 'ES' } }, 1000);
  expect(result.ok).toBe(true);
  expect(document.querySelector).toHaveBeenCalledWith('#country');
  expect(select.value).toBe('ES');
});
it.each(['hidden', 'disabled', 'option-disabled', 'missing'])('does not change a select when %s', async (condition) => {
  select.hidden = condition === 'hidden';
  select.disabled = condition === 'disabled';
  select.options[0].disabled = condition === 'option-disabled';
  const result = await runAction({ name: 'select', arguments: { ref: '@e1', value: condition === 'missing' ? 'XX' : 'ES' } }, 1000);
  expect(result.ok).toBe(false);
  expect(select.dispatchEvent).not.toHaveBeenCalled();
});
