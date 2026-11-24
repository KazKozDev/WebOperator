import { followCollection, goal, incomplete, progress, type Collection } from '@/lib/collection';
import type { ToolCall } from '@/lib/types';

/**
 * browser_extract mode="rows" | "chunk" for MCP clients: the same saved, self-checking
 * collection the side-panel agent uses. Each call follows the list (Next, scroll, recheck)
 * or the article (next chunk) inside a time budget and saves progress under collectionId,
 * so a client resumes with another call instead of steering every page itself.
 */

const STORE_KEY = 'bridgeCollections';
const MAX_STORED = 20;
/** Well inside the 30 s every bridge path allows, leaving room for one slow last step. */
const FOLLOW_BUDGET_MS = 12_000;

type Mode = 'rows' | 'chunk';
interface Stored { collection: Collection; mode: Mode; tabId: number; selector?: string; updatedAt: number }
type Store = Record<string, Stored>;

export interface CollectDeps {
  run(call: ToolCall): Promise<{ ok: boolean; extracted?: unknown; error?: string }>;
  now?: () => number;
  newId?: () => string;
}

export type StopReason = 'complete' | 'deadline' | 'stalled' | 'no_more_pages' | 'single_capture' | 'error';

async function loadStore(): Promise<Store> {
  const raw = (await chrome.storage.session.get(STORE_KEY))[STORE_KEY];
  return raw && typeof raw === 'object' ? raw as Store : {};
}

async function saveStore(store: Store): Promise<void> {
  const kept = Object.entries(store).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, MAX_STORED);
  await chrome.storage.session.set({ [STORE_KEY]: Object.fromEntries(kept) });
}

function optionalInt(value: unknown, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return n;
}

export async function bridgeCollect(tabId: number, payload: Record<string, unknown>, deps: CollectDeps): Promise<Record<string, unknown>> {
  const mode = payload.mode;
  if (mode !== 'rows' && mode !== 'chunk') throw new Error('mode must be "rows" or "chunk"');
  const target = optionalInt(payload.target, 'target', 1, 10_000);
  const since = optionalInt(payload.since, 'since', 0, Number.MAX_SAFE_INTEGER) ?? 0;
  const requestedId = payload.collectionId;
  if (requestedId !== undefined && (typeof requestedId !== 'string' || !/^[\w-]{1,64}$/.test(requestedId))) {
    throw new Error('collectionId must be 1-64 letters, digits, "-" or "_"');
  }
  const selector = typeof payload.selector === 'string' && payload.selector.trim() ? payload.selector.trim() : undefined;
  const now = deps.now ?? Date.now;

  const store = await loadStore();
  let id = requestedId as string | undefined;
  let entry = id ? store[id] : undefined;
  if (id && !entry) throw new Error(`Unknown or expired collectionId "${id}"; omit it to start a new collection`);
  if (entry && entry.mode !== mode) throw new Error(`Collection "${id}" was started with mode "${entry.mode}"`);
  if (entry && entry.tabId !== tabId) throw new Error(`Collection "${id}" belongs to tab ${entry.tabId}`);
  if (!entry) {
    id = (deps.newId ?? (() => crypto.randomUUID()))();
    entry = { collection: { rows: [], pages: [], documents: [] }, mode, tabId, updatedAt: now() };
  }
  if (selector) entry.selector = selector;

  const read: ToolCall = {
    name: 'extract',
    arguments: { refs: mode, ...(entry.selector ? { selector: entry.selector } : {}), ...(target ? { target } : {}) },
  };
  const outcome = await followCollection(entry.collection, read, deps.run, { deadline: now() + FOLLOW_BUDGET_MS, now });
  entry.updatedAt = now();
  store[id!] = entry;
  await saveStore(store);

  const c = entry.collection;
  const want = goal(c);
  const done = !incomplete(c) && (mode === 'chunk' ? c.documents.length > 0 : Boolean(want));
  const stopReason: StopReason = outcome.error ? 'error'
    : done ? 'complete'
      : outcome.timedOut ? 'deadline'
        : c.stalled ? 'stalled'
          : mode === 'rows' && !want ? 'single_capture'
            : 'no_more_pages';
  const base = {
    ok: !outcome.error,
    collectionId: id,
    mode,
    complete: done,
    stopReason,
    progress: progress(c),
    steps: outcome.steps,
    ...(outcome.error ? { error: outcome.error } : {}),
  };
  if (mode === 'rows') {
    return {
      ...base,
      saved: c.rows.length,
      ...(want ? { target: want } : {}),
      ...(c.claimed ? { claimed: c.claimed } : {}),
      rows: c.rows.slice(since),
      nextSince: c.rows.length,
    };
  }
  const doc = c.documents.at(-1);
  return {
    ...base,
    saved: doc?.text.length ?? 0,
    total: doc?.total ?? 0,
    ...(doc?.position ? { position: doc.position } : {}),
    text: doc?.text.slice(since) ?? '',
    nextSince: doc?.text.length ?? 0,
  };
}
