import type { ToolCall } from './types';
import { fastHash } from './hash';

export interface CollectedRow { key: string; text: string; href?: string }
export interface PageRows {
  kind: 'rows';
  source: string;
  rows: CollectedRow[];
  range?: [number, number];
  /** The total the page's own pager claims ("1–50 of 180" → 180). */
  claimed?: number;
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
  /** The last section heading that starts before the end of this chunk. */
  heading?: string;
}
export interface Collection {
  rows: CollectedRow[];
  target?: number;
  /** The total the page claims; caps the target when the site has fewer records. */
  claimed?: number;
  /** Set when a capture after a scroll or Next added nothing, even after one recheck. */
  stalled?: boolean;
  rechecked?: boolean;
  pages: { source: string; start: number; end: number; keys: string[] }[];
  documents: { source: string; revision: string; text: string; total: number; position?: string }[];
}

const CHUNK_CHARS = 6000;
const STALL_RECHECK_MS = 2500;

/**
 * How many records the collection should end with: the request, capped by what the page claims.
 * A claimed total alone never becomes the goal, so "1–50 of 2,345" does not start a 2,345-row crawl.
 */
export function goal(c: Collection): number | undefined {
  return c.target && c.claimed ? Math.min(c.target, c.claimed) : c.target;
}

/** Parses a pager label such as "1–50 of 1,234" into the shown range and the claimed total. */
export function parseRange(label: string): { range: [number, number]; claimed: number } | undefined {
  const match = label.match(/(?:^|\s)(\d+)\s*[-–—]\s*(\d+)\s+(?:of|из|de|sur|von)\s+(\d{1,3}(?:[,.\u00a0 ]\d{3})+|\d+)/i);
  if (!match) return undefined;
  const start = +match[1], end = +match[2], claimed = +match[3].replace(/\D/g, '');
  if (!(start > 0 && end >= start && claimed >= end)) return undefined;
  return { range: [start, end], claimed };
}

/** End of the chunk that starts at offset: snapped back to a paragraph or line break, never empty. */
export function chunkEnd(full: string, offset: number, max = CHUNK_CHARS): number {
  if (offset + max >= full.length) return full.length;
  const window = full.slice(offset, offset + max);
  for (const sep of ['\n\n', '\n', '. ']) {
    const at = window.lastIndexOf(sep);
    if (at >= max / 2) return offset + at + sep.length;
  }
  return offset + max;
}

/** The last heading whose text starts before end, located in order through the full text. */
export function lastHeadingBefore(full: string, headings: string[], end: number): string | undefined {
  let cursor = 0;
  let last: string | undefined;
  for (const heading of headings) {
    const at = full.indexOf(heading, cursor);
    if (at < 0) continue;
    if (at >= end) break;
    last = heading;
    cursor = at + heading.length;
  }
  return last;
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
    const end = chunkEnd(full, offset);
    const headings = [...article.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,[role="heading"]')]
      .map(h => h.innerText.trim()).filter(Boolean);
    const heading = lastHeadingBefore(full, headings, end);
    return { kind: 'chunk', source, revision, offset, total: full.length, text: full.slice(offset, end), ...(heading ? { heading } : {}) };
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
    const parsed = parseRange(el.innerText);
    if (parsed) { page.range = parsed.range; page.claimed = parsed.claimed; break; }
  }
  return page;
}

export function mergeCollection(c: Collection, batch: PageRows | TextChunk): void {
  if (batch.kind === 'chunk') {
    const doc = c.documents.find(d => d.source === batch.source);
    if (!doc || doc.revision !== batch.revision) {
      if (batch.offset !== 0) throw new Error('Document changed; restart at offset zero');
      const next = { source: batch.source, revision: batch.revision, total: batch.total, text: batch.text, position: batch.heading };
      if (doc) Object.assign(doc, next);
      else c.documents.push(next);
    } else if (batch.offset === doc.text.length) {
      doc.text += batch.text;
      if (batch.heading) doc.position = batch.heading;
    }
    else if (doc.text.slice(batch.offset, batch.offset + batch.text.length) !== batch.text || batch.offset > doc.text.length) throw new Error('Non-contiguous text chunk');
    return;
  }
  if (batch.claimed && c.target) c.claimed = batch.claimed;
  const want = goal(c);
  if (batch.range && want) {
    const missing = firstUnverified(c);
    if (batch.range[0] > missing) throw new Error(`Return to the range containing row ${missing} before collecting ${batch.range[0]}–${batch.range[1]}.`);
  }
  const seen = new Set(c.rows.map(r => r.key));
  for (const row of batch.rows) {
    if (seen.has(row.key) || (want && c.rows.length >= want)) continue;
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
  const want = goal(c);
  const count = `${c.rows.length}${want ? '/' + want : ''}`;
  const capped = c.target && c.claimed && c.claimed < c.target ? ` (requested ${c.target}; the page claims only ${c.claimed})` : '';
  const lines = [`${count} unique rows saved${capped}`];
  if (c.stalled) lines.push(`loading stopped at ${count}: a recheck after the last scroll or page change added nothing`);
  for (const p of c.pages) lines.push(`range ${p.start}–${p.end}: ${p.keys.length} distinct rows observed`);
  for (const d of c.documents) lines.push(`${d.source}: ${d.text.length}/${d.total} characters saved${d.position ? `, reached "${d.position}"` : ''}`);
  return lines.join('\n');
}

export function incomplete(c: Collection): boolean {
  const want = goal(c);
  return Boolean(want && c.rows.length < want) || c.documents.some(d => d.text.length < d.total) ||
    c.pages.some(p => p.keys.length < Math.min(p.end, want ?? p.end) - p.start + 1);
}

function firstUnverified(c: Collection): number {
  let first = 1;
  for (const p of [...c.pages].sort((a, b) => a.start - b.start)) {
    if (p.start > first) break;
    if (p.keys.length >= p.end - p.start + 1) first = Math.max(first, p.end + 1);
  }
  return first;
}

/**
 * The steps that continue a collection after one capture. `moved` says whether a scroll,
 * page change or wait came right before it: only then does a capture that adds nothing
 * count as a stalled load. A plain re-read (a resumed call, a model retry) moves on instead.
 */
export function collectionFollowUp(c: Collection, batch: PageRows | TextChunk, read: ToolCall, advanced: boolean, moved = true): ToolCall[] {
  if (batch.kind === 'chunk') return advanced && batch.offset + batch.text.length < batch.total ? [read] : [];
  const want = goal(c);
  if (!want || c.rows.length >= want) return [];
  if (!advanced && moved) {
    // Lazy lists often answer a scroll a moment late: look once more before calling it a stall.
    if (c.rechecked) { c.stalled = true; return []; }
    c.rechecked = true;
    return [{ name: 'wait', arguments: { ms: STALL_RECHECK_MS, until: 'none', reason: 'Recheck a load that added no records' } }, read];
  }
  if (advanced) {
    c.rechecked = false;
    c.stalled = false;
  }
  const fullPage = !batch.range || firstUnverified(c) > batch.range[1];
  if (fullPage && batch.nextRef) {
    return [{ name: 'click', arguments: { ref: batch.nextRef, reason: 'Next page of requested records' } }, read];
  }
  if (batch.scrollBy) {
    return [{ name: 'scroll', arguments: { direction: 'down', amountPx: batch.scrollBy, collectionList: true } }, read];
  }
  return [];
}

/** Merges one capture into the collection and returns the steps that continue it. */
export function applyBatch(c: Collection, batch: PageRows | TextChunk, read: ToolCall, moved = true): { queue: ToolCall[]; advanced: boolean } {
  const requested = Number(read.arguments.target);
  if (batch.kind === 'rows' && !c.target && Number.isSafeInteger(requested) && requested > 0) c.target = requested;
  const previous = batch.kind === 'rows' ? c.rows.length : c.documents.find(d => d.source === batch.source)?.text.length ?? 0;
  mergeCollection(c, batch);
  const advanced = batch.kind === 'rows'
    ? c.rows.length > previous
    : batch.text.length > 0 && (batch.offset === 0 || batch.offset + batch.text.length > previous);
  return { queue: collectionFollowUp(c, batch, read, advanced, moved), advanced };
}

const isRead = (call: ToolCall) => call.name === 'extract' && (call.arguments.refs === 'rows' || call.arguments.refs === 'chunk');

export interface FollowOutcome { steps: number; timedOut: boolean; error?: string }

/**
 * Runs a collection to its end (target met, no more pages, stall, or chunk total reached)
 * without a model in the loop: the same traversal the agent queues, for callers such as
 * the MCP bridge. Stops at the deadline and leaves the collection resumable.
 */
export async function followCollection(
  c: Collection,
  read: ToolCall,
  run: (call: ToolCall) => Promise<{ ok: boolean; extracted?: unknown; error?: string }>,
  opts: { deadline: number; now?: () => number; maxSteps?: number },
): Promise<FollowOutcome> {
  const now = opts.now ?? Date.now;
  const maxSteps = opts.maxSteps ?? 200;
  let queue: ToolCall[] = [read];
  let steps = 0;
  let moved = false;
  while (queue.length) {
    if (now() >= opts.deadline || steps >= maxSteps) return { steps, timedOut: true };
    let call = queue.shift()!;
    if (call.arguments.refs === 'chunk') {
      const prior = c.documents.at(-1);
      call = { ...call, arguments: { ...call.arguments, offset: prior?.text.length ?? 0, revision: prior?.revision } };
    }
    const result = await run(call);
    steps++;
    if (!result.ok) return { steps, timedOut: false, error: result.error ?? `${call.name} failed` };
    if (!isRead(call)) { moved = true; continue; }
    try {
      queue = applyBatch(c, result.extracted as PageRows | TextChunk, read, moved).queue;
      moved = false;
    } catch (err) {
      return { steps, timedOut: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { steps, timedOut: false };
}
