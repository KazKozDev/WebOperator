import type { A11yNode } from './types';

export function fieldInfo(el: HTMLElement): NonNullable<A11yNode['field']> {
  const field: NonNullable<A11yNode['field']> = {};
  const native = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
  if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|url|tel|email|password)$/.test(el.type))) {
    if (el.maxLength >= 0) field.maxLength = el.maxLength;
    if (el.minLength >= 0) field.minLength = el.minLength;
  }
  const root = el.getRootNode() as Document | ShadowRoot;
  const linked = (attribute: string) => (el.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean)
    .map(id => root.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ').slice(0, 300);
  const description = linked('aria-describedby') || el.getAttribute('aria-description') || '';
  // Some editors render an unlabelled counter immediately after their field.
  const sibling = el.nextElementSibling;
  const counter = sibling instanceof HTMLElement && sibling.checkVisibility() ? sibling.innerText.trim() : '';
  const isCounter = /^(?:\d+\s*\/\s*\d+|\d+ characters? (?:left|remaining)|(?:осталось|quedan|restan) \d+ (?:символ\S*|caracteres?))$/iu.test(counter);
  const hint = [description, isCounter && counter !== description ? counter : ''].filter(Boolean).join(' ');
  if (hint) field.hint = hint;
  const invalid = el.getAttribute('aria-invalid');
  if ((native && el.willValidate && !el.validity.valid) || (invalid && invalid !== 'false')) {
    field.error = el instanceof HTMLInputElement && el.type === 'password' ? 'Invalid password field' :
      linked('aria-errormessage') || (native && el.validationMessage) || description || 'Invalid field';
  }
  return field;
}

export function fieldValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
  return el.innerText;
}

export function checkFieldLength(info: ReturnType<typeof fieldInfo>, current: string, expected: string): void {
  if (info.maxLength !== undefined && expected.length > info.maxLength) {
    throw new Error(`Field maxlength is ${info.maxLength} UTF-16 units. Requested total is ${expected.length}.`);
  }
  if (info.minLength !== undefined && expected.length > 0 && expected.length < info.minLength) {
    throw new Error(`Field minlength is ${info.minLength} UTF-16 units. Requested total is ${expected.length}.`);
  }
  // A custom counter can count graphemes, bytes or code units. Infer a hard
  // boundary only where those measures agree and the unit is explicit.
  if (!info.hint || !/^[\x20-\x7e]*$/.test(current + expected)) return;
  const fraction = info.hint.match(/^(\d+)\s*\/\s*(\d+)$/);
  const maximum = info.hint.match(/\b(?:max(?:imum)?(?: of)?|up to)\s+(\d+)\s+characters?\b/i);
  const limit = maximum ? Number(maximum[1]) : fraction && Number(fraction[1]) === current.length ? Number(fraction[2]) : undefined;
  if (limit !== undefined && expected.length > limit) throw new Error(`Field counter limits the value to ${limit} characters.`);
  const remaining = info.hint.match(/\b(\d+) characters? (?:remaining|left)\b/i)
    ?? info.hint.match(/(?:осталось|restan|quedan)\s+(\d+)\s+(?:символ|caracter)/iu);
  if (remaining && expected.length - current.length > Number(remaining[1])) {
    throw new Error(`Field counter allows ${remaining[1]} additional characters.`);
  }
}

export function prepareField(el: HTMLElement, text: string, append: boolean, info: ReturnType<typeof fieldInfo>, current: string): string {
  if (el.matches(':disabled, [readonly], [aria-readonly="true"], [aria-disabled="true"]')) {
    throw new Error('Field is disabled or read-only.');
  }
  // HTML textareas represent line breaks as LF.
  if (el instanceof HTMLTextAreaElement) text = text.replace(/\r\n?/g, '\n');
  const expected = append ? current + text : text;
  checkFieldLength(info, current, expected);
  return expected;
}

export function verifyField(el: HTMLElement, expected: string, actual: string, info: ReturnType<typeof fieldInfo>): void {
  if (!el.isConnected) throw new Error('Field was replaced. Inspect its current value before retrying.');
  if (info.error) throw new Error(`Field rejected the value: ${info.error}`);
  if (actual !== expected) throw new Error(`Field changed the requested value (expected length ${expected.length}, actual ${actual.length}). Inspect before retrying.`);
}
