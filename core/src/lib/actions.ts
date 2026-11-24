import { collectionScroller, readCollection } from './collection';
import type { ActionResult, CSResponse, ToolCall } from './types';
import { buildSnapshot, findElementByRef } from './a11y';
import { hasAutosaveHint, isFormSave, isSaveLabel } from './form-save';
import { fieldInfo, fieldValue, prepareField, verifyField } from './text-field';
import { parseBatchActions, validateBatchCall } from './batch-actions';

interface BatchActionOutcome {
  index: number;
  name: ToolCall['name'];
  ok: boolean;
  error?: string;
}

class BatchActionError extends Error {
  constructor(message: string, readonly outcomes: BatchActionOutcome[]) {
    super(message);
  }
}

export async function runAction(call: ToolCall, timeoutMs: number): Promise<ActionResult> {
  const start = performance.now();
  try {
    const result = await withTimeout(dispatch(call), timeoutMs);
    return { ok: true, durationMs: performance.now() - start, ...(result ? { extracted: result } : {}) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: performance.now() - start,
      ...(err instanceof BatchActionError ? { extracted: { outcomes: err.outcomes, stoppedAt: err.outcomes.length } } : {}),
    };
  }
}

async function dispatch(call: ToolCall): Promise<unknown> {
  switch (call.name) {
    case 'set_task_plan':
      return undefined;
    case 'batch_actions': return doBatchActions(call);
    case 'click': return doClick(String(call.arguments.ref ?? ''));
    case 'type': return doType(
      String(call.arguments.ref ?? ''),
      String(call.arguments.text ?? ''),
      String(call.arguments.mode ?? 'replace') === 'append' ? 'append' : 'replace',
      String(call.arguments.submit ?? 'false') === 'true',
    );
    case 'press': return doPress(
      String(call.arguments.key ?? ''),
      String(call.arguments.modifiers ?? ''),
      call.arguments.ref ? String(call.arguments.ref) : undefined,
    );
    case 'select': return doSelect(String(call.arguments.ref ?? ''), String(call.arguments.value ?? ''));
    case 'scroll': return doScroll(
      String(call.arguments.direction ?? 'down'),
      call.arguments.ref ? String(call.arguments.ref) : undefined,
      typeof call.arguments.amountPx === 'number' ? call.arguments.amountPx : 400,
      call.arguments.to ? String(call.arguments.to) : undefined,
      call.arguments.block ? String(call.arguments.block) : 'center',
      call.arguments.collectionList === true,
    );
    case 'wait': return doWait(
      Math.min(Number(call.arguments.ms ?? 1000), 120_000),
      String(call.arguments.until ?? 'none'),
      call.arguments.ref ? String(call.arguments.ref) : undefined,
      call.arguments,
    );
    case 'extract':
      if (call.arguments.refs === 'rows' || call.arguments.refs === 'chunk') return readCollection(call.arguments.refs, call.arguments);
      return doExtract(String(call.arguments.refs ?? ''));
    case 'navigate':
    case 'done':
    case 'open_tab':
    case 'switch_tab':
    case 'list_tabs':
    case 'close_tabs':
    case 'bookmark_tabs':
    case 'group_tabs':
    case 'ungroup_tabs':
    case 'paste_table':
    case 'fill_cells':
    case 'select_cell':
    case 'set_cell':
    case 'read_cells':
    case 'define_sheet_contract':
    case 'fill_login_credentials':
    case 'solve_captcha':
    case 'read_downloaded_file':
    case 'inspect_csv':
    case 'transform_csv':
    case 'confirm_submission':
    case 'list_connectors':
    case 'call_connector':
    case 'numbers_read':
    case 'numbers_edit':
    case 'upload_attachment':
    case 'start_subtask':
    case 'finish_subtask':
    case 'fail_subtask':
    case 'update_task_memory':

      return undefined;

    default:
      throw new Error(`Unknown action: ${(call as { name: string }).name}`);
  }
}

async function doBatchActions(call: ToolCall): Promise<{ outcomes: BatchActionOutcome[]; completed: number }> {
  const validationError = validateBatchCall(call);
  if (validationError) throw new BatchActionError(validationError, []);

  const outcomes: BatchActionOutcome[] = [];
  for (const [index, action] of parseBatchActions(call).entries()) {
    try {
      await dispatch(action);
      outcomes.push({ index, name: action.name, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcomes.push({ index, name: action.name, ok: false, error: message });
      throw new BatchActionError(`Batch stopped at action ${index + 1} (${action.name}): ${message}`, outcomes);
    }
  }
  return { outcomes, completed: outcomes.length };
}

function resolve(ref: string, block: ScrollLogicalPosition = 'center'): HTMLElement {
  const el = ref.startsWith('@') ? findElementByRef(ref) : document.querySelector<HTMLElement>(ref);
  if (!el) throw new Error(`Element ${ref} not found in current snapshot`);
  el.scrollIntoView({ block, behavior: 'instant' as ScrollBehavior });
  const rect = el.getBoundingClientRect();
  if (!isVisibleElement(el) || (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) ||
      rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) {
    throw new Error('Element not visible after scroll');
  }
  return el;
}

async function doClick(ref: string): Promise<void> {
  const el = resolve(ref);
  type Point = { x: number; y: number };
  const state = globalThis as unknown as Record<symbol, unknown>;
  const paint = state[Symbol.for('weboperator.cursorPaint')] as ((point: Point, pressed?: boolean) => boolean) | undefined;
  const rect = el.getBoundingClientRect();
  const x = (Math.max(0, rect.left) + Math.min(window.innerWidth, rect.right)) / 2;
  const y = (Math.max(0, rect.top) + Math.min(window.innerHeight, rect.bottom)) / 2;
  if (paint) {
    const start = (state[Symbol.for('weboperator.virtualCursor')] as () => Point)();
    for (let i = 1; i <= 16; i++) {
      paint({ x: start.x + (x - start.x) * i / 16, y: start.y + (y - start.y) * i / 16 });
      await new Promise<void>(resolve => setTimeout(resolve, 16));
    }
    if (!el.isConnected) throw new Error('Target disappeared during cursor movement');
    paint({ x, y }, true);
  }
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y });
  const dispatched = el.dispatchEvent(event);
  if (!dispatched) throw new Error('Click was cancelled by page');
  await tick();
}

const intendedValues = new WeakMap<HTMLElement, string>();

export function captureSaveContext(call: ToolCall): CSResponse {
  const ref = String(call.arguments.ref ?? '');
  const target = ref.startsWith('@') ? findElementByRef(ref) : ref ? document.querySelector<HTMLElement>(ref) : activeTarget();
  if (!target) return { kind: 'ok' };
  if (call.name === 'click' && !isSaveLabel(target.getAttribute('aria-label') || target.innerText || (target as HTMLInputElement).value || target.title || '') && !target.hasAttribute('aria-labelledby')) return { kind: 'ok' };
  if (call.name === 'type' && String(call.arguments.submit) !== 'true' && !hasAutosaveHint(fieldInfo(target).hint)) return { kind: 'ok' };
  const refPrefix = (target.dataset.agentRef ?? ref).match(/^@(.*)e\d+$/)?.[1] ?? '';
  const snapshot = buildSnapshot({ refPrefix, shadow: true, includeOutsideViewport: true });
  const targetRef = target.dataset.agentRef;
  if (!targetRef || !isFormSave(snapshot, call.name, { ...call.arguments, ref: targetRef })) return { kind: 'ok' };
  const form = (target as HTMLInputElement).form ?? target.closest('form');
  const controls = form ? new Set([...form.elements, ...form.querySelectorAll('[contenteditable]')]) : [];
  for (const field of controls) {
    if (!(field instanceof HTMLElement)) continue;
    const expected = intendedValues.get(field);
    if (expected !== undefined && !(call.name === 'type' && target === field)) {
      verifyField(field, expected, fieldValue(field), fieldInfo(field));
    }
  }
  return { kind: 'save:context', snapshot, ref: targetRef, refPrefix };
}

async function doType(ref: string, text: string, mode: 'replace' | 'append', submit: boolean): Promise<void> {
  const el = resolve(ref);
  const native = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
  const field = native ? el : resolveContentEditable(el);
  if (!field) throw new Error(`Element ${ref} is not a text input`);
  field.focus();
  const current = fieldValue(field);
  const expected = prepareField(field, text, mode === 'append', fieldInfo(field), current);
  intendedValues.set(field, expected);
  if (expected !== current) {
    const inputType = text ? 'insertText' : 'deleteContentBackward';
    const event = { bubbles: true, composed: true, inputType, data: text || null };
    if (!field.dispatchEvent(new InputEvent('beforeinput', { ...event, cancelable: true }))) {
      throw new Error('Field cancelled beforeinput. Inspect the field before retrying.');
    }
    if (!field.isConnected) throw new Error('Field was replaced during beforeinput.');
    if (fieldValue(field) !== current) throw new Error('Field changed during beforeinput. Inspect before retrying.');
    if (native) {
      const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (!setter) throw new Error('Value setter is unavailable.');
      setter.call(el, expected);
      el.dispatchEvent(new InputEvent('input', event));
    } else {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(field);
      if (mode === 'append') range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (!document.execCommand(text ? 'insertText' : 'delete', false, text)) {
        throw new Error('Field rejected the editor operation.');
      }
    }
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }
  field.blur();
  await tick();
  verifyField(field, expected, fieldValue(field), fieldInfo(field));
  if (submit || document.activeElement === document.body) field.focus();
  if (submit) pressEnter(field, {}, true);
}

// CDP delivers trusted input events. Keep comparison values in the originating
// frame, including passwords, and bind verification to the exact edited element.
const nativeEdits = new Map<string, { field: HTMLElement; expected: string }>();

export function prepareNativeEdit(ref: string, text: string, append: boolean) {
  const target = resolve(ref);
  const field = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target : resolveContentEditable(target);
  if (!field) throw new Error('Target is not an editable field');
  field.focus();
  if (!field.matches(':focus')) throw new Error('Field did not receive focus');
  const current = fieldValue(field);
  const expected = prepareField(field, text, append, fieldInfo(field), current);
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    if (append && current.length && field.selectionEnd === null) throw new Error('Cannot place caret at end of field');
    if (append && field.selectionEnd !== null) field.setSelectionRange(current.length, current.length);
    if (!append) field.select();
  } else {
    const range = document.createRange();
    range.selectNodeContents(field);
    if (append) range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  const token = crypto.getRandomValues(new Uint32Array(4)).join('-');
  intendedValues.set(field, expected);
  nativeEdits.set(token, { field, expected });
  setTimeout(() => nativeEdits.delete(token), 10_000);
  return { token, needsInput: current !== expected };
}

export async function verifyNativeEdit(token: string, submit: boolean, retainFocus = false): Promise<void> {
  const edit = nativeEdits.get(token);
  nativeEdits.delete(token);
  if (!edit) throw new Error('Native edit expired. Inspect the field before retrying.');
  const { field, expected } = edit;
  if (!retainFocus) field.blur();
  await tick();
  verifyField(field, expected, fieldValue(field), fieldInfo(field));
  if (submit) {
    field.focus();
    if (!field.matches(':focus')) throw new Error('Cannot submit a field that lost focus');
  }
}

async function doPress(key: string, modifiersText: string, ref?: string): Promise<void> {
  const target = ref ? resolve(ref) : activeTarget();
  target.focus();
  const modifiers = parseModifiers(modifiersText);
  const normalizedKey = normalizeKey(key);

  if ((modifiers.metaKey || modifiers.ctrlKey) && !modifiers.shiftKey && !modifiers.altKey) {
    const command = shortcutCommand(normalizedKey);
    if (command) {
      document.execCommand(command, false);
      dispatchEditorInput(activeTarget());
      await tick();
      return;
    }
  }

  if (normalizedKey === 'Enter') pressEnter(target, modifiers, false);
  else {
    dispatchKey(target, 'keydown', normalizedKey, modifiers);
    dispatchKey(target, 'keyup', normalizedKey, modifiers);
  }
  await tick();
}

function pressEnter(target: HTMLElement, modifiers: KeyboardEventInit, submit: boolean): void {
  const form = (target as HTMLInputElement).form ?? target.closest('form');
  let submitted = false;
  const onSubmit = () => { submitted = true; };
  form?.addEventListener('submit', onSubmit, true);
  try {
    const accepted = dispatchKey(target, 'keydown', 'Enter', modifiers);
    if (accepted && !submit && target.isContentEditable) {
      document.execCommand('insertParagraph', false);
      dispatchEditorInput(target);
    }
    const released = dispatchKey(target, 'keyup', 'Enter', modifiers);
    if (!accepted || !released || submitted || !target.isConnected) return;
    if (!submit && target instanceof HTMLButtonElement) {
      target.click();
      return;
    }
    if (!form || Object.values(modifiers).some(Boolean)) return;
    const implicit = target instanceof HTMLInputElement && /^(text|email|url|search|password|tel|number)$/.test(target.type);
    if (!submit && !implicit) return;
    const submitter = Array.from(form.elements).find(el =>
      (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) && el.type === 'submit');
    if (submitter instanceof HTMLElement) submitter.click();
    else if (submit || form.querySelectorAll('input:not([type="hidden"])').length === 1) form.requestSubmit();
  } finally {
    form?.removeEventListener('submit', onSubmit, true);
  }
}

function resolveContentEditable(el: HTMLElement): HTMLElement | null {
  if (el.isContentEditable) return el;
  const child = el.querySelector<HTMLElement>('[contenteditable]:not([contenteditable="false"])');
  if (child?.isContentEditable) return child;
  const parent = el.closest<HTMLElement>('[contenteditable="true"]');
  return parent?.isContentEditable ? parent : null;
}

function activeTarget(): HTMLElement {
  return document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
}

function parseModifiers(value: string): Pick<KeyboardEventInit, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'> {
  const parts = value.toLowerCase().split(/[\s,+]+/).filter(Boolean);
  return {
    altKey: parts.includes('alt') || parts.includes('option'),
    ctrlKey: parts.includes('ctrl') || parts.includes('control'),
    metaKey: parts.includes('meta') || parts.includes('cmd') || parts.includes('command'),
    shiftKey: parts.includes('shift'),
  };
}

function normalizeKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) throw new Error('press requires key');
  if (trimmed.length === 1) return trimmed.toLowerCase();
  return trimmed;
}

function shortcutCommand(key: string): string | null {
  switch (key.toLowerCase()) {
    case 'b': return 'bold';
    case 'i': return 'italic';
    case 'u': return 'underline';
    default: return null;
  }
}

function dispatchKey(target: HTMLElement, type: 'keydown' | 'keyup', key: string, modifiers: KeyboardEventInit): boolean {
  return target.dispatchEvent(new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    ...modifiers,
  }));
}

function dispatchEditorInput(target: HTMLElement, data?: string): void {
  target.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data,
  }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
}

async function doSelect(ref: string, value: string): Promise<void> {
  const el = resolve(ref);
  if (!(el instanceof HTMLSelectElement)) throw new Error(`Element ${ref} is not a <select>`);
  if (el.disabled) throw new Error('Select is disabled');
  const lowerVal = value.trim().toLowerCase();
  const match = Array.from(el.options).find(
    (o) =>
      o.value === value ||
      o.textContent?.trim() === value.trim() ||
      o.value.toLowerCase() === lowerVal ||
      o.textContent?.trim().toLowerCase() === lowerVal,
  );
  if (!match) throw new Error(`Option "${value}" not found`);
  if (match.disabled || (match.parentElement instanceof HTMLOptGroupElement && match.parentElement.disabled)) throw new Error('Option is disabled');
  el.value = match.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function findScrollableContainer(target?: HTMLElement | null): HTMLElement | null {
  let curr = target ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  while (curr && curr !== document.body && curr !== document.documentElement) {
    try {
      const style = window.getComputedStyle(curr);
      const overflowY = style.overflowY;
      const isScrollable = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
        curr.scrollHeight > curr.clientHeight + 10;
      if (isScrollable) return curr;
    } catch {
      // Ignore if disconnected
    }
    curr = curr.parentElement;
  }
  return null;
}

async function doScroll(
  direction: string,
  ref: string | undefined,
  amountPx: number,
  to?: string,
  block = 'center',
  collectionList = false,
): Promise<{ scrolled: boolean; scrollY: number; atBoundary: boolean; note?: string }> {
  if (to !== undefined && to !== 'element') throw new Error(`Unknown scroll target: ${to}`);
  if (to === 'element') {
    if (!ref) throw new Error('scroll to=element requires ref');
    if (!['start', 'center', 'end', 'nearest'].includes(block)) throw new Error(`Invalid scroll block: ${block}`);
    const beforeY = window.scrollY;
    resolve(ref, block as ScrollLogicalPosition);
    await tick();
    return { scrolled: window.scrollY !== beforeY, scrollY: Math.round(window.scrollY), atBoundary: false };
  }
  let container: HTMLElement | null = null;
  if (ref) {
    const el = findElementByRef(ref);
    if (el instanceof HTMLElement) {
      container = findScrollableContainer(el) ?? el;
    }
  } else {
    container = collectionList ? collectionScroller() ?? null : findScrollableContainer();
  }

  const isContainer = Boolean(container && container !== document.body && container !== document.documentElement);
  const beforeY = isContainer && container ? container.scrollTop : window.scrollY;
  const maxScrollY = isContainer && container
    ? Math.max(0, container.scrollHeight - container.clientHeight)
    : Math.max(0, Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - window.innerHeight);

  if (isContainer && container) {
    switch (direction) {
      case 'up': container.scrollBy({ top: -amountPx, behavior: 'instant' as ScrollBehavior }); break;
      case 'down': container.scrollBy({ top: amountPx, behavior: 'instant' as ScrollBehavior }); break;
      case 'top': container.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); break;
      case 'bottom': container.scrollTo({ top: container.scrollHeight, behavior: 'instant' as ScrollBehavior }); break;
      case 'to_ref': {
        if (!ref) throw new Error('scroll to_ref requires ref');
        resolve(ref);
        break;
      }
      default: throw new Error(`Unknown direction: ${direction}`);
    }
  } else {
    switch (direction) {
      case 'up': window.scrollBy({ top: -amountPx, behavior: 'instant' as ScrollBehavior }); break;
      case 'down': window.scrollBy({ top: amountPx, behavior: 'instant' as ScrollBehavior }); break;
      case 'top': window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); break;
      case 'bottom': window.scrollTo({ top: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight), behavior: 'instant' as ScrollBehavior }); break;
      case 'to_ref': {
        if (!ref) throw new Error('scroll to_ref requires ref');
        resolve(ref);
        break;
      }
      default: throw new Error(`Unknown direction: ${direction}`);
    }
  }
  // A lazy list fetches its next rows after the scroll lands; give it time before the next capture.
  await (collectionList ? waitForSettledDom(2500, 400) : tick());

  const afterY = isContainer && container ? container.scrollTop : window.scrollY;
  const delta = Math.abs(afterY - beforeY);
  const atBottom = afterY >= maxScrollY - 10;
  const atTop = afterY <= 10;
  const scrolled = delta > 2;

  let note: string | undefined;
  if (!scrolled && direction === 'down') {
    note = 'Page bottom reached or scroll position unchanged. Stop scrolling: extract what is visible, search, or navigate.';
  } else if (!scrolled && direction === 'up') {
    note = 'Page top reached or scroll position unchanged.';
  } else if (atBottom && direction === 'down') {
    note = 'Page bottom reached. All content on this page is now visible.';
  }

  return {
    scrolled,
    scrollY: Math.round(afterY),
    atBoundary: atBottom || atTop,
    ...(note ? { note } : {}),
  };
}

async function doWait(ms: number, until: string, ref?: string, options: Record<string, unknown> = {}): Promise<{ matched?: string }> {
  if (until === 'none' || until === 'timeout') { await sleep(ms); return {}; }
  const pollMs = Number(options.pollMs ?? 150);
  const selector = typeof options.selector === 'string' ? options.selector : undefined;
  const text = typeof options.text === 'string' ? options.text : undefined;
  if (until === 'element' && !ref && !selector) throw new Error('element wait requires ref or selector');
  if (until === 'text' && !text) throw new Error('text wait requires text');
  if (!['element', 'text', 'load', 'network_idle'].includes(until)) throw new Error(`Unknown wait condition: ${until}`);
  const start = Date.now();
  let changedAt = start;
  const observer = until === 'network_idle' ? new MutationObserver(() => { changedAt = Date.now(); }) : undefined;
  observer?.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  try {
    do {
      const el = ref ? findElementByRef(ref) : selector ? document.querySelector<HTMLElement>(selector) : document.body;
      if (until === 'load' && document.readyState === 'complete') return {};
      if (until === 'network_idle' && Date.now() - changedAt >= 500) return { matched: 'dom_quiet' };
      if (until === 'element' && el && (options.visible !== true || isVisibleElement(el))) return { matched: ref || selector };
      if (until === 'text' && el) {
        const candidates = options.visible === true ? [el, ...el.querySelectorAll<HTMLElement>('*')] : [el];
        if (candidates.some((node) => (options.visible !== true || isVisibleElement(node)) && (node.innerText ?? node.textContent ?? '').includes(text!))) return { matched: text };
      }
      if (Date.now() - start >= ms) break;
      await sleep(Math.min(pollMs, ms - (Date.now() - start)));
    } while (Date.now() - start <= ms);
    throw new Error(`Wait ${until} ${ref || selector || text || ''} did not match within ${ms}ms`);
  } finally { observer?.disconnect(); }
}

type ExtractedItem = { ref: string; text: string; value?: string; href?: string };

function doExtract(refs: string): ExtractedItem[] {
  const mode = refs.trim().toLowerCase();
  if (mode === 'visible') return extractVisibleText();
  if (mode === 'all') {
    const full = normalizeText(document.body.innerText);
    return [{ ref: 'document.body', text: full.slice(0, 12_000), ...(full.length > 12_000
      ? { value: 'Partial preview. Use refs="chunk" for the complete text or refs="rows" for a list.' } : {}) }];
  }

  return refs.split(',').map((r) => r.trim()).filter(Boolean).map((ref) => {
    const el = findElementByRef(ref);
    if (!el) return { ref, text: '' };
    const value = (el as HTMLInputElement).value;
    const href = el instanceof HTMLAnchorElement ? el.href : '';
    return { ref, text: normalizeText(el.textContent ?? ''), ...(value ? { value } : {}), ...(href ? { href } : {}) };
  });
}

function extractVisibleText(maxItems = 80): ExtractedItem[] {
  const selectors = [
    'h1', 'h2', 'h3', 'h4', 'p', 'li', 'dt', 'dd',
    'blockquote', 'figcaption', '[role="heading"]',
    '[data-attrid]', '[data-sncf]', '[aria-level]',
  ].join(',');
  const candidates: Array<ExtractedItem & { score: number; top: number }> = [];
  const seen = new Set<string>();
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  for (const el of document.querySelectorAll<HTMLElement>(selectors)) {
    if (!isVisibleElement(el)) continue;
    const rect = el.getBoundingClientRect();
    const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < viewportH && rect.left < viewportW;
    if (!inViewport) continue;
    const text = normalizeText(el.textContent ?? '');
    if (!isUsefulText(text) || seen.has(text)) continue;
    seen.add(text);
    candidates.push({ ref: cssPath(el), text, score: scoreText(text, rect), top: rect.top });
  }

  if (candidates.length === 0) {
    const text = normalizeText(document.body.innerText);
    if (text) candidates.push({ ref: 'document.body', text: text.slice(0, 4_000), score: 0, top: 0 });
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.top - b.top)
    .slice(0, maxItems)
    .map((item) => ({
      ref: item.ref,
      text: item.text,
      ...(item.value ? { value: item.value } : {}),
      ...(item.href ? { href: item.href } : {}),
    }));
}

function isVisibleElement(el: HTMLElement): boolean {
  if (el.hidden) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function isUsefulText(text: string): boolean {
  if (text.length < 8) return false;
  if (/^(todos?|all|videos?|im[aá]genes|web|noticias|m[aá]s|herramientas)$/i.test(text)) return false;
  if (/^(mostrar m[aá]s|vista creada con ia|m[aá]s preguntas)$/i.test(text)) return false;
  if (text.length > 1_200) return false;
  return true;
}

function scoreText(text: string, rect: DOMRect): number {
  let score = 0;
  if (/[А-Яа-яЁё]/.test(text)) score += 8;
  if (/правильно|пишется|русск|вариант|написани|официальн|разговорн|youtube|ютуб/i.test(text)) score += 8;
  if (/[.!?…:]$/.test(text)) score += 2;
  if (text.length >= 40 && text.length <= 500) score += 4;
  if (rect.top < window.innerHeight * 0.65) score += 2;
  return score;
}

function cssPath(el: HTMLElement): string {
  if (el.id) return `#${el.id}`;
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;
  const siblings = Array.from(parent.children).filter((child) => child.tagName === el.tagName);
  if (siblings.length <= 1) return tag;
  return `${tag}:nth-of-type(${siblings.indexOf(el) + 1})`;
}

export function waitForSettledDom(maxWaitMs = 1200, quietMs = 100): Promise<void> {
  return new Promise((resolve) => {
    let timer: number | null = null;
    let maxTimeout: number | null = null;
    let observer: MutationObserver | null = null;

    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
      if (maxTimeout !== null) clearTimeout(maxTimeout);
      if (observer) observer.disconnect();
    };

    const done = () => {
      cleanup();
      resolve();
    };

    try {
      if (typeof MutationObserver !== 'undefined' && document?.documentElement) {
        observer = new MutationObserver(() => {
          if (timer !== null) clearTimeout(timer);
          timer = window.setTimeout(done, quietMs);
        });
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
      }
      timer = window.setTimeout(done, quietMs);
      maxTimeout = window.setTimeout(done, maxWaitMs);
    } catch {
      setTimeout(done, quietMs);
    }
  });
}

function tick(): Promise<void> { return waitForSettledDom(600, 50); }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Action timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
