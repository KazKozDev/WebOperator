import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareNativeEdit, runAction, verifyNativeEdit } from './actions';
import { fieldInfo } from './text-field';

const { findElementByRef } = vi.hoisted(() => ({ findElementByRef: vi.fn() }));
vi.mock('./a11y', () => ({ findElementByRef }));

class Field extends EventTarget {
  #value = '';
  get value() { return this.#value; }
  set value(value: string) { this.#value = value; }
  type = 'text';
  minLength = -1;
  maxLength = -1;
  isConnected = true;
  willValidate = true;
  validity = { valid: true };
  validationMessage = '';
  attributes = new Map<string, string>();
  descriptions = new Map<string, { textContent: string }>();
  form = { checkValidity: () => true, requestSubmit: vi.fn() };
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  getRootNode() { return { getElementById: (id: string) => this.descriptions.get(id) }; }
  matches(selector: string) { return selector === ':focus'; }
  selectionEnd = 0;
  setSelectionRange(_start: number, end: number) { this.selectionEnd = end; }
  select() {}
  getBoundingClientRect() { return { left: 1, top: 1, right: 60, bottom: 21, width: 59, height: 20 }; }
  scrollIntoView() {}
  focus() {}
  blur() { this.dispatchEvent(new Event('blur')); }
}

describe('checked text edits', () => {
  let field: Field;
  beforeEach(() => {
    field = new Field();
    findElementByRef.mockReturnValue(field);
    vi.stubGlobal('HTMLElement', Field);
    vi.stubGlobal('HTMLInputElement', Field);
    vi.stubGlobal('HTMLTextAreaElement', class extends Field {});
    vi.stubGlobal('InputEvent', Event);
    vi.stubGlobal('document', { activeElement: null, body: {} });
    vi.stubGlobal('window', { innerHeight: 600, innerWidth: 800, getComputedStyle: () => ({}), setTimeout });
  });
  afterEach(() => vi.unstubAllGlobals());
  const type = (text: string, args: Record<string, unknown> = {}) => runAction({ name: 'type', arguments: { ref: '@e1', text, ...args } }, 1000);

  it('checks the live UTF-16 limit against the full append before any mutation', async () => {
    field.maxLength = 4;
    field.value = 'ab';
    expect((await type('😀', { mode: 'append' })).ok).toBe(true);
    expect(field.value).toBe('ab😀');
    expect((await type('X', { mode: 'append', submit: true })).error).toContain('maxlength');
    expect(field.value).toBe('ab😀');
    expect(field.form.requestSubmit).not.toHaveBeenCalled();
  });
  it('reads linked counters and distinguishes an unknown limit from zero', async () => {
    expect(fieldInfo(field as unknown as HTMLElement)).toEqual({});
    field.attributes.set('aria-describedby', 'counter');
    field.descriptions.set('counter', { textContent: '3 characters remaining' });
    expect((await type('four')).error).toContain('3 additional');
    field.maxLength = 0;
    expect((await type('X')).error).toContain('maxlength is 0');
    expect(field.value).toBe('');
  });
  it('preserves the previous text when replacement is cancelled', async () => {
    field.value = 'old';
    field.addEventListener('beforeinput', event => event.preventDefault());
    expect((await type('new')).ok).toBe(false);
    expect(field.value).toBe('old');
  });
  it('checks asynchronous normalization on blur before submit', async () => {
    field.addEventListener('blur', () => setTimeout(() => { field.value = field.value.slice(0, 2); }, 5));
    expect((await type('long', { submit: true })).error).toContain('actual 2');
    expect(field.form.requestSubmit).not.toHaveBeenCalled();
  });
  it('reads a site-specific field error without submitting', async () => {
    field.addEventListener('input', () => {
      field.attributes.set('aria-invalid', 'true');
      field.attributes.set('aria-errormessage', 'err');
      field.descriptions.set('err', { textContent: 'Title exceeds budget' });
    });
    expect((await type('draft', { submit: true })).error).toContain('Title exceeds budget');
    expect(field.form.requestSubmit).not.toHaveBeenCalled();
  });
  it('prepares a native append at the end and rejects a missing prefix before Enter', async () => {
    field.maxLength = 4;
    field.value = 'ab';
    expect(() => prepareNativeEdit('@e1', 'xyz', true)).toThrow('maxlength');
    const { token } = prepareNativeEdit('@e1', 'xy', true);
    expect(field.selectionEnd).toBe(2);
    field.value = 'xy';
    await expect(verifyNativeEdit(token, true)).rejects.toThrow('actual 2');
    expect(field.form.requestSubmit).not.toHaveBeenCalled();
  });
  it('honors a rich-text editor cancelling replacement', async () => {
    vi.stubGlobal('HTMLInputElement', class extends Field {});
    Object.assign(field, { isContentEditable: true, innerText: 'old' });
    field.addEventListener('beforeinput', event => event.preventDefault());
    expect((await type('new')).error).toContain('cancelled beforeinput');
    expect((field as unknown as HTMLElement).innerText).toBe('old');
  });
  it('stops a batch on a rejected first write', async () => {
    field.minLength = 3;
    const next = new Field();
    findElementByRef.mockImplementation(ref => ref === '@e1' ? field : next);
    const result = await runAction({ name: 'batch_actions', arguments: { actions: [
      { name: 'type', ref: '@e1', text: 'ab' }, { name: 'type', ref: '@e2', text: 'untouched' },
    ] } }, 1000);
    expect(result.error).toContain('minlength');
    expect(next.value).toBe('');
  });
});
