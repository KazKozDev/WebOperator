import { db } from './storage';
import { fastHash } from './hash';
import type { A11ySnapshot, ToolCall } from './types';

export interface CachedAction {
  key: string;
  urlPattern: string;
  intentHash: string;
  domHash: string;
  calls: ToolCall[];
  expectedDomHash: string;
  createdAt: number;
  expiresAt: number;
  hits: number;
}

export function makeKey(urlPattern: string, intentHash: string, domHash: string): string {
  return `${urlPattern}::${intentHash}::${domHash}`;
}

export function urlPattern(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

export function intentHash(goal: string): string {
  return fastHash(goal.trim().toLowerCase().replace(/\s+/g, ' '));
}

export async function lookup(urlPat: string, intent: string, dom: string): Promise<CachedAction | undefined> {
  const key = makeKey(urlPat, intent, dom);
  const row = await db.actionCache.get(key);
  if (!row) return undefined;
  if (row.expiresAt < Date.now()) { await db.actionCache.delete(key); return undefined; }
  return row;
}

export async function store(entry: Omit<CachedAction, 'key' | 'createdAt' | 'expiresAt' | 'hits'>, ttlDays: number): Promise<void> {
  const now = Date.now();
  const record: CachedAction = {
    ...entry,
    key: makeKey(entry.urlPattern, entry.intentHash, entry.domHash),
    createdAt: now,
    expiresAt: now + ttlDays * 24 * 60 * 60 * 1000,
    hits: 0,
  };
  await db.actionCache.put(record);
}

export async function bumpHits(key: string): Promise<void> {
  const row = await db.actionCache.get(key);
  if (!row) return;
  await db.actionCache.update(key, { hits: row.hits + 1 });
}

export async function clearCache(): Promise<number> {
  const n = await db.actionCache.count();
  await db.actionCache.clear();
  return n;
}

export async function invalidate(key: string): Promise<void> {
  await db.actionCache.delete(key);
}

export function summarizeCall(call: ToolCall): string {
  const parts: string[] = [call.name];
  const a = call.arguments;
  if (a.ref) parts.push(`ref=${a.ref}`);
  if (a.text) parts.push(`text="${String(a.text).slice(0, 24)}"`);
  if (a.url) parts.push(`url=${a.url}`);
  if (a.value) parts.push(`value=${a.value}`);
  if (a.key) parts.push(`key=${a.key}`);
  if (a.modifiers) parts.push(`modifiers=${a.modifiers}`);
  return parts.join(' ');
}

export function snapshotSignature(s: A11ySnapshot): string {
  return s.domHash;
}
