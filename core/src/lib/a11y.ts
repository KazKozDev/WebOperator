import type { A11yNode, A11ySnapshot, A11yRole } from './types';
import { fastHash } from './hash';

const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox',
  'radio', 'switch', 'slider', 'tab', 'menuitem', 'option', 'listbox',
]);

export interface SnapshotOptions {
  includeOutsideViewport?: boolean;
  maxNodes?: number;
}

export function buildSnapshot(opts: SnapshotOptions = {}): A11ySnapshot {
  const { includeOutsideViewport = false, maxNodes = 400 } = opts;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const nodes: A11yNode[] = [];
  const refMap = new WeakMap<Element, string>();
  let counter = 1;

  const all = document.querySelectorAll<HTMLElement>(
    'a,button,input,select,textarea,summary,[role],[contenteditable="true"],[tabindex]'
  );

  // Phase 1: collect viewport-visible elements first
  for (const el of all) {
    if (nodes.length >= maxNodes) break;
    if (!isVisible(el)) continue;
    const role = computeRole(el);
    if (!role) continue;
    const name = accessibleName(el);
    if (role === 'generic' && !name && !el.getAttribute('aria-label') && !el.getAttribute('title')) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < viewportH && rect.left < viewportW;
    if (!inViewport) continue;

    const ref = `@e${counter++}`;
    refMap.set(el, ref);
    nodes.push(buildNode(el, ref, role, name, rect, true));
    (el as HTMLElement).dataset.agentRef = ref;
  }

  // Phase 2: fill remaining slots with off-screen elements (only if requested)
  if (includeOutsideViewport && nodes.length < maxNodes) {
    for (const el of all) {
      if (nodes.length >= maxNodes) break;
      if (!isVisible(el)) continue;
      if (refMap.has(el)) continue;
      const role = computeRole(el);
      if (!role) continue;
      const name = accessibleName(el);
      if (role === 'generic' && !name && !el.getAttribute('aria-label') && !el.getAttribute('title')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const ref = `@e${counter++}`;
      refMap.set(el, ref);
      nodes.push(buildNode(el, ref, role, name, rect, false));
      (el as HTMLElement).dataset.agentRef = ref;
    }
  }

  const structure = nodes.map((n) => `${n.role}:${n.name.slice(0, 40)}`).join('|');
  const textSnippets = visibleTextSnippets();
  const textStructure = textSnippets.map((t) => t.slice(0, 40)).join('|');
  const domHash = fastHash(`${location.pathname}::${structure}::${textStructure}`);

  return {
    url: location.href,
    title: document.title,
    viewport: { w: viewportW, h: viewportH, scrollX: window.scrollX, scrollY: window.scrollY },
    nodes,
    textSnippets,
    domHash,
    takenAt: Date.now(),
  };
}

export function findElementByRef(ref: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-agent-ref="${CSS.escape(ref)}"]`);
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
