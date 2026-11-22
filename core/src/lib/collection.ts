import type { ToolCall } from './types';
import { fastHash } from './hash';

export interface CollectedRow { key: string; text: string; href?: string }
export interface PageRows {
  kind: 'rows';
  source: string;
  rows: CollectedRow[];
  range?: [number, number];
  nextRef?: string;
  scrollBy?: number;
}
export interface TextChunk {
  kind: 'chunk';
  source: string;
  revision: string;
  offset: number;
  total: number;
  text: string;
}
export interface Collection {
  rows: CollectedRow[];
  target?: number;
  pages: { source: string; start: number; end: number; keys: string[] }[];
  documents: { source: string; revision: string; text: string; total: number }[];
}

let listScroller: HTMLElement | undefined;

export function collectionScroller(): HTMLElement | undefined {
  return listScroller?.isConnected ? listScroller : undefined;
}

export function readCollection(mode: 'rows' | 'chunk', args: Record<string, unknown>): PageRows | TextChunk {
  const selector = typeof args.selector === 'string' ? args.selector.trim() : '';
  const scope = document.querySelector<HTMLElement>('[role="main"],main') ?? document.body;
  const source = location.href;
  if (mode === 'chunk') {
    const article = selector ? document.querySelector<HTMLElement>(selector) : scope.querySelector<HTMLElement>('article') ?? scope;
    if (!article) throw new Error('Text container not found');
    const full = article.innerText;
    if (!full.trim()) throw new Error('Text container is empty');
    const revision = fastHash(full);
    const offset = args.revision === revision ? Number(args.offset ?? 0) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > full.length) throw new Error('Invalid text offset');
    return { kind: 'chunk', source, revision, offset, total: full.length, text: full.slice(offset, offset + 6000) };
  }

  // Prefer one homogeneous group of siblings over unrelated lists and navigation links.
  const groups = new Map<Element, HTMLElement[]>();
  const candidates = (selector ? document : scope).querySelectorAll<HTMLElement>(selector || 'tr,[role="row"],article,li,[role="listitem"],[itemtype*="Product"]');
  for (const el of candidates) {
    if (!el.parentElement || !el.getClientRects().length || !el.innerText.trim() || el.closest('nav,header,footer,thead') || el.querySelector('[role="columnheader"],th[scope="col"]')) continue;
    const siblings = groups.get(el.parentElement) ?? [];
    siblings.push(el);
    groups.set(el.parentElement, siblings);
  }
  const records = selector ? [...candidates].filter(el => groups.get(el.parentElement!)?.includes(el))
    : [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  if (!records.length) throw new Error('No readable records in this container; inspect the list and pass a row selector.');
  const rows = records.map(el => {
    const textParts = [el.innerText.trim()];
    if (location.hostname === 'mail.google.com') {
      const date = el.querySelector<HTMLElement>('td:last-child [title]')?.title;
      if (date) textParts.push(date);
      if (el.classList.contains('zE')) textParts.push('Unread');
      else if (el.classList.contains('yO')) textParts.push('Read');
    }
    const text = textParts.join(' · ');
    const href = (el.matches('a[href]') ? el as HTMLAnchorElement : el.querySelector<HTMLAnchorElement>('a[href]'))?.href;
    const id = el.getAttribute('data-thread-id') ?? el.querySelector('[data-legacy-thread-id]')?.getAttribute('data-legacy-thread-id') ?? el.getAttribute('data-id');
    const key = JSON.stringify([location.origin, id || href || text]);
    return { key, text, ...(href ? { href } : {}) };
  });
  // Only accept a pager-shaped label, never numbers embedded in a record.
  const page: PageRows = { kind: 'rows', source, rows };
  const pager = [...document.querySelectorAll<HTMLElement>('a[rel~="next"], nav [data-agent-ref], [role="navigation"] [data-agent-ref], [role="toolbar"] [data-agent-ref], [aria-label="Older"][data-agent-ref], [data-tooltip="Older"][data-agent-ref]')].find(el => {
    const name = el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || el.title || el.innerText;
    return el.dataset.agentRef && el.getClientRects().length && !el.matches(':disabled,[aria-disabled="true"]') &&
      (el.matches('a[rel~="next"]') || /^(next( page)?|older|следующая( страница)?|далее|более ранние|siguiente)$/i.test(name.trim()));
  });
  page.nextRef = pager?.dataset.agentRef;
  listScroller = undefined;
  for (let el = records[0]?.parentElement; el; el = el.parentElement) {
    if ((el === document.scrollingElement || /auto|scroll/.test(getComputedStyle(el).overflowY)) && el.scrollTop + el.clientHeight + 1 < el.scrollHeight) {
      listScroller = el;
      page.scrollBy = Math.max(1, Math.floor(el.clientHeight * 0.8));
      break;
    }
  }
  const labels = [...document.querySelectorAll<HTMLElement>('[role="navigation"],[role="toolbar"],nav,[aria-live],.Dj')];
  for (const el of labels) {
    if (!el.getClientRects().length) continue;
    const match = el.innerText.match(/(?:^|\s)(\d+)\s*[-–—]\s*(\d+)\s+(?:of|из|de|sur|von)\s+[\d, .\u00a0]+/i);
    if (match && +match[1] > 0 && +match[2] >= +match[1]) { page.range = [+match[1], +match[2]]; break; }
  }
  return page;
}

export function mergeCollection(c: Collection, batch: PageRows | TextChunk): void {
  if (batch.kind === 'chunk') {
    const doc = c.documents.find(d => d.source === batch.source);
    if (!doc || doc.revision !== batch.revision) {
      if (batch.offset !== 0) throw new Error('Document changed; restart at offset zero');
      const next = { source: batch.source, revision: batch.revision, total: batch.total, text: batch.text };
      if (doc) Object.assign(doc, next);
      else c.documents.push(next);
    } else if (batch.offset === doc.text.length) doc.text += batch.text;
    else if (doc.text.slice(batch.offset, batch.offset + batch.text.length) !== batch.text || batch.offset > doc.text.length) throw new Error('Non-contiguous text chunk');
    return;
  }
  if (batch.range && c.target) {
    const missing = firstUnverified(c);
    if (batch.range[0] > missing) throw new Error(`Return to the range containing row ${missing} before collecting ${batch.range[0]}–${batch.range[1]}.`);
  }
  const seen = new Set(c.rows.map(r => r.key));
  for (const row of batch.rows) {
    if (seen.has(row.key) || (c.target && c.rows.length >= c.target)) continue;
    c.rows.push(row);
    seen.add(row.key);
  }
  if (batch.range) {
    const [start, end] = batch.range;
    let page = c.pages.find(p => p.source === batch.source && p.start === start && p.end === end);
    if (!page) { page = { source: batch.source, start, end, keys: [] }; c.pages.push(page); }
    page.keys = [...new Set([...page.keys, ...batch.rows.map(r => r.key)])];
  }
}

export function progress(c: Collection): string {
  const lines = [`${c.rows.length}${c.target ? '/' + c.target : ''} unique rows saved`];
  for (const p of c.pages) lines.push(`range ${p.start}–${p.end}: ${p.keys.length} distinct rows observed`);
  for (const d of c.documents) lines.push(`${d.source}: ${d.text.length}/${d.total} characters saved`);
  return lines.join('\n');
}

export function incomplete(c: Collection): boolean {
  return Boolean(c.target && c.rows.length < c.target) || c.documents.some(d => d.text.length < d.total) ||
    c.pages.some(p => p.keys.length < Math.min(p.end, c.target ?? p.end) - p.start + 1);
}

function firstUnverified(c: Collection): number {
  let first = 1;
  for (const p of [...c.pages].sort((a, b) => a.start - b.start)) {
    if (p.start > first) break;
    if (p.keys.length >= p.end - p.start + 1) first = Math.max(first, p.end + 1);
  }
  return first;
}

export function collectionFollowUp(c: Collection, batch: PageRows | TextChunk, read: ToolCall, advanced: boolean): ToolCall[] {
  if (!advanced) return [];
  if (batch.kind === 'chunk') return batch.offset + batch.text.length < batch.total ? [read] : [];
  if (!c.target || c.rows.length >= c.target) return [];
  const fullPage = !batch.range || firstUnverified(c) > batch.range[1];
  if (fullPage && batch.nextRef) {
    return [{ name: 'click', arguments: { ref: batch.nextRef, reason: 'Next page of requested records' } }, read];
  }
  if (batch.scrollBy) {
    return [{ name: 'scroll', arguments: { direction: 'down', amountPx: batch.scrollBy, collectionList: true } }, read];
  }
  return [];
}
