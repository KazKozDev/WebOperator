import type { ActionResult, ToolCall } from './types';
import { findElementByRef } from './a11y';

export async function runAction(call: ToolCall, timeoutMs: number): Promise<ActionResult> {
  const start = performance.now();
  try {
    const result = await withTimeout(dispatch(call), timeoutMs);
    return { ok: true, durationMs: performance.now() - start, ...(result ? { extracted: result } : {}) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), durationMs: performance.now() - start };
  }
}

async function dispatch(call: ToolCall): Promise<unknown> {
  switch (call.name) {
    case 'set_task_plan':
      return undefined;
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
    );
    case 'wait': return doWait(
      Math.min(Number(call.arguments.ms ?? 1000), 10_000),
      String(call.arguments.until ?? 'none'),
      call.arguments.ref ? String(call.arguments.ref) : undefined,
    );
    case 'extract': return doExtract(String(call.arguments.refs ?? ''));
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
    case 'start_subtask':
    case 'finish_subtask':
    case 'fail_subtask':
    case 'update_task_memory':
      return undefined;
    default:
      throw new Error(`Unknown action: ${(call as { name: string }).name}`);
  }
}

function resolve(ref: string): HTMLElement {
  const el = findElementByRef(ref);
  if (!el) throw new Error(`Element ${ref} not found in current snapshot`);
  el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
  return el;
}

async function doClick(ref: string): Promise<void> {
  const el = resolve(ref);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
  const dispatched = el.dispatchEvent(event);
  if (!dispatched) throw new Error('Click was cancelled by page');
  await tick();
}

async function doType(ref: string, text: string, mode: 'replace' | 'append', submit: boolean): Promise<void> {
  const el = resolve(ref);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (mode === 'replace') {
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
      setter?.call(el, '');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    }
    el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
    setter?.call(el, mode === 'append' ? `${el.value}${text}` : text);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (submit) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
      const form = el.closest('form');
      form?.requestSubmit?.();
    }
    return;
  }
  const editable = resolveContentEditable(el);
  if (editable) {
    throw new Error('contenteditable requires CDP (trusted input)');
  }
  throw new Error(`Element ${ref} is not a text input`);
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

  dispatchKey(target, 'keydown', normalizedKey, modifiers);
  if (normalizedKey === 'Enter' && activeTarget().isContentEditable) {
    document.execCommand('insertParagraph', false);
    dispatchEditorInput(activeTarget());
  }
  dispatchKey(target, 'keyup', normalizedKey, modifiers);
  await tick();
}

function resolveContentEditable(el: HTMLElement): HTMLElement | null {
  if (el.isContentEditable) return el;
  const child = el.querySelector<HTMLElement>('[contenteditable="true"]');
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

function dispatchKey(target: HTMLElement, type: 'keydown' | 'keyup', key: string, modifiers: KeyboardEventInit): void {
  target.dispatchEvent(new KeyboardEvent(type, {
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
  const match = Array.from(el.options).find(
    (o) => o.value === value || o.textContent?.trim() === value.trim(),
  );
  if (!match) throw new Error(`Option "${value}" not found`);
  el.value = match.value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function doScroll(direction: string, ref: string | undefined, amountPx: number): Promise<void> {
  switch (direction) {
    case 'up': window.scrollBy({ top: -amountPx, behavior: 'instant' as ScrollBehavior }); break;
    case 'down': window.scrollBy({ top: amountPx, behavior: 'instant' as ScrollBehavior }); break;
    case 'top': window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); break;
    case 'bottom': window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' as ScrollBehavior }); break;
    case 'to_ref': {
      if (!ref) throw new Error('scroll to_ref requires ref');
      resolve(ref);
      break;
    }
    default: throw new Error(`Unknown direction: ${direction}`);
  }
  await tick();
}

async function doWait(ms: number, until: string, ref?: string): Promise<void> {
  if (until === 'none') { await sleep(ms); return; }
  if (until === 'load') {
    if (document.readyState === 'complete') return;
    await new Promise<void>((resolve) => {
      const done = () => { window.removeEventListener('load', done); resolve(); };
      window.addEventListener('load', done, { once: true });
      setTimeout(done, ms);
    });
    return;
  }
  if (until === 'element') {
    if (!ref) throw new Error('wait until=element requires ref');
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (findElementByRef(ref)) return;
      await sleep(100);
    }
    throw new Error(`Element ${ref} did not appear within ${ms}ms`);
  }
  if (until === 'network_idle') {
    await sleep(Math.min(ms, 2000));
    return;
  }
}

type ExtractedItem = { ref: string; text: string; value?: string; href?: string };

function doExtract(refs: string): ExtractedItem[] {
  const mode = refs.trim().toLowerCase();
  if (mode === 'visible') return extractVisibleText();
  if (mode === 'all') return [{ ref: 'document.body', text: normalizeText(document.body.innerText).slice(0, 12_000) }];

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

function tick(): Promise<void> { return new Promise((r) => setTimeout(r, 50)); }
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
