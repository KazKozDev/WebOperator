import type { A11yNode, A11ySnapshot, A11yRole, SnapshotRequestOptions } from './types';
import { fastHash } from './hash';

const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox',
  'radio', 'switch', 'slider', 'tab', 'menuitem', 'option', 'listbox',
]);

export interface SnapshotOptions extends SnapshotRequestOptions { includeOutsideViewport?: boolean }
const refsByPrefix = new Map<string, { refs: WeakMap<Element, string>; next: number }>();
const SELECTORS = 'a,button,input,select,textarea,summary,[role],[contenteditable="true"],[tabindex]';

/** Query reachable open roots; refs remain actionable in the same roots. */
export function queryOpenRoots<T extends HTMLElement = HTMLElement>(selector: string, root: Document | ShadowRoot | HTMLElement = document): T[] {
  const result = [...root.querySelectorAll<T>(selector)];
  for (const host of root.querySelectorAll<HTMLElement>('*')) if (host.shadowRoot) result.push(...queryOpenRoots<T>(selector, host.shadowRoot));
  return result;
}

export function buildSnapshot(opts: SnapshotOptions = {}): A11ySnapshot {
  const { includeOutsideViewport = false, maxNodes = 400, refPrefix = '' } = opts;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  let registry = refsByPrefix.get(refPrefix);
  if (!registry) { registry = { refs: new WeakMap(), next: 1 }; refsByPrefix.set(refPrefix, registry); }
  const selector = `${SELECTORS}${opts.includeImages ? ',img[src]' : ''}`;
  const all = opts.shadow ? queryOpenRoots(selector) : [...document.querySelectorAll<HTMLElement>(selector)];
  const candidates: { el: HTMLElement; role: A11yRole; name: string; rect: DOMRect; inViewport: boolean }[] = [];
  for (const el of all) {
    if (!isVisible(el)) continue;
    const role = el.tagName === 'IMG' && opts.includeImages ? 'image' : computeRole(el);
    if (!role) continue;
    const name = accessibleName(el);
    if (role === 'generic' && !name && !el.getAttribute('aria-label') && !el.getAttribute('title')) continue;
    if (opts.roles?.length && !opts.roles.includes(role) && !(role === 'image' && opts.roles.includes('img'))) continue;
    if (opts.query && !`${name} ${readValue(el) ?? ''} ${el.innerText ?? ''}`.toLowerCase().includes(opts.query.toLowerCase())) continue;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    if (el.tagName === 'IMG' && rect.width * rect.height < (opts.minImageArea ?? 0)) continue;
    const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < viewportH && rect.left < viewportW;
    if (!inViewport && !includeOutsideViewport) continue;
    candidates.push({ el, role, name, rect, inViewport });
  }
  candidates.sort((a, b) => Number(b.inViewport) - Number(a.inViewport));
  const nodes = candidates.slice(0, maxNodes).map(({ el, role, name, rect, inViewport }) => {
    let ref = registry.refs.get(el);
    if (!ref) { ref = `@${refPrefix}e${registry.next++}`; registry.refs.set(el, ref); }
    el.dataset.agentRef = ref;
    const node = buildNode(el, ref, role, name, rect, inViewport);
    if (opts.text) node.text = (el.innerText ?? el.textContent ?? '').trim().slice(0, 200);
    if (el.tagName === 'IMG') {
      const img = el as HTMLImageElement;
      Object.assign(node, { src: img.currentSrc || img.src, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
    }
    const frame = /^f(\d+)/.exec(refPrefix);
    node.frameId = frame ? Number(frame[1]) : 0;
    return node;
  });
  const textSnippets = visibleTextSnippets();
  const domHash = fastHash(`${location.pathname}::${nodes.map((node) => JSON.stringify(node)).join('|')}::${textSnippets.join('|')}`);
  return { url: location.href, title: document.title, viewport: { w: viewportW, h: viewportH, scrollX: window.scrollX, scrollY: window.scrollY }, nodes, textSnippets, domHash, takenAt: Date.now(), total: candidates.length, truncated: candidates.length > nodes.length, frameCount: 1 };
}

export function findElementByRef(ref: string): HTMLElement | null {
  const selector = `[data-agent-ref="${CSS.escape(ref)}"]`;
  return document.querySelector<HTMLElement>(selector) ?? queryOpenRoots(selector)[0] ?? null;
}

export function formatSnapshot(s: A11ySnapshot): string {
  const head = `URL: ${s.url}\nTITLE: ${s.title}\nVIEWPORT: ${s.viewport.w}x${s.viewport.h} (scroll ${s.viewport.scrollX},${s.viewport.scrollY})\nNODES (${s.nodes.length}):`;
  const lines = s.nodes.map((n) => {
    const value = n.value ? ` value="${ellipsis(n.value, 40)}"` : '';
    const href = n.href ? ` href="${ellipsis(n.href, 80)}"` : '';
    const state = n.state?.length ? ` [${n.state.join(',')}]` : '';
    return `  ${n.ref} ${n.role} "${ellipsis(n.name, 60)}"${value}${href}${state} @${n.bbox.x},${n.bbox.y} ${n.bbox.w}x${n.bbox.h}`;
  });
  const snippets = s.textSnippets?.length
    ? `\nVISIBLE TEXT (${s.textSnippets.length}):\n${s.textSnippets.map((t) => `  - ${ellipsis(t, 140)}`).join('\n')}`
    : '';
  return `${head}\n${lines.join('\n')}${snippets}`;
}

function ellipsis(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  if ((el as HTMLInputElement).type === 'hidden') return false;
  return true;
}

function visibleTextSnippets(maxSnippets = 30): string[] {
  const selectors = [
    'h1', 'h2', 'h3', 'h4', 'p', 'li', 'dt', 'dd',
    'blockquote', 'figcaption', '[role="heading"]',
  ].join(',');
  const snippets: string[] = [];
  const seen = new Set<string>();
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  for (const el of document.querySelectorAll<HTMLElement>(selectors)) {
    if (snippets.length >= maxSnippets) break;
    if (!isVisible(el)) continue;
    const rect = el.getBoundingClientRect();
    const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < viewportH && rect.left < viewportW;
    if (!inViewport) continue;
    const text = normalizeText(el.textContent ?? '');
    if (text.length < 12 || seen.has(text)) continue;
    seen.add(text);
    snippets.push(text);
  }

  return snippets;
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function computeRole(el: HTMLElement): A11yRole | null {
  const explicit = el.getAttribute('role');
  if (explicit && INTERACTIVE_ROLES.has(explicit)) return explicit as A11yRole;
  const tag = el.tagName;
  if (!INTERACTIVE_TAGS.has(tag) && !el.hasAttribute('contenteditable') && el.getAttribute('tabindex') === null) {
    if (!explicit) return null;
  }
  switch (tag) {
    case 'A': return (el as HTMLAnchorElement).href ? 'link' : 'generic';
    case 'BUTTON': return 'button';
    case 'SELECT': return 'combobox';
    case 'TEXTAREA': return 'textbox';
    case 'SUMMARY': return 'button';
    case 'INPUT': {
      const t = (el as HTMLInputElement).type.toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'range') return 'slider';
      if (t === 'submit' || t === 'button' || t === 'reset') return 'button';
      if (t === 'search') return 'searchbox';
      return 'textbox';
    }
  }
  if (el.getAttribute('contenteditable') === 'true') return 'textbox';
  if (explicit) return (explicit as A11yRole);
  return 'generic';
}

function accessibleName(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const refs = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    if (refs.trim()) return refs.trim();
  }
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
    const id = el.id;
    if (id) {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label?.textContent) return label.textContent.trim();
    }
    const parentLabel = el.closest('label');
    if (parentLabel?.textContent) return parentLabel.textContent.trim();
    const ph = (el as HTMLInputElement).placeholder;
    if (ph) return ph.trim();
  }
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
    const ph = el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') || el.dataset.placeholder;
    if (ph) return ph.trim();
  }
  const editableChild = el.querySelector<HTMLElement>('[contenteditable="true"], textarea, input');
  const childPlaceholder = editableChild?.getAttribute('aria-label')
    || editableChild?.getAttribute('placeholder')
    || editableChild?.getAttribute('aria-placeholder')
    || editableChild?.dataset.placeholder;
  if (childPlaceholder) return childPlaceholder.trim();
  if (el.tagName === 'IMG') return (el as HTMLImageElement).alt || '';
  const title = el.getAttribute('title');
  if (title) return title.trim();
  const text = el.textContent?.trim().replace(/\s+/g, ' ') ?? '';
  return text;
}

function readValue(el: HTMLElement): string | undefined {
  if (el instanceof HTMLInputElement) {
    const t = el.type.toLowerCase();
    if (t === 'password') return '••••••';
    if (t === 'checkbox' || t === 'radio') return el.checked ? 'checked' : 'unchecked';
    return el.value || undefined;
  }
  if (el instanceof HTMLTextAreaElement) return el.value || undefined;
  if (el instanceof HTMLSelectElement) return el.value || undefined;
  if (el.getAttribute('contenteditable') === 'true') return el.textContent?.trim() || undefined;
  return undefined;
}

function readState(el: HTMLElement): string[] {
  const s: string[] = [];
  if ((el as HTMLButtonElement).disabled) s.push('disabled');
  if (el.getAttribute('aria-disabled') === 'true') s.push('disabled');
  if (el.getAttribute('aria-expanded') === 'true') s.push('expanded');
  if (el.getAttribute('aria-selected') === 'true') s.push('selected');
  if (el.getAttribute('aria-checked') === 'true') s.push('checked');
  if ((el as HTMLInputElement).required) s.push('required');
  return s;
}

function buildNode(el: HTMLElement, ref: string, role: A11yRole, name: string, rect: DOMRect, inViewport: boolean): A11yNode {
  const node: A11yNode = {
    ref,
    role,
    name,
    bbox: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) },
    inViewport,
  };
  const value = readValue(el);
  if (value !== undefined) node.value = value;
  if (el instanceof HTMLAnchorElement && el.href) node.href = el.href;
  const state = readState(el);
  if (state.length > 0) node.state = state;
  return node;
}
