import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bridgeCollect } from './bridge-collection';
import type { ToolCall } from '@/lib/types';

let stored: Record<string, unknown> = {};
beforeEach(() => {
  stored = {};
  vi.stubGlobal('chrome', { storage: { session: {
    get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(stored, JSON.parse(JSON.stringify(items))); }),
  } } });
});
afterEach(() => vi.unstubAllGlobals());

const rows = (first: number, last: number) => Array.from({ length: last - first + 1 }, (_, i) => ({ key: String(first + i), text: 'Job ' + (first + i) }));

/** A paged list of `total` records, 50 per page, with a Next control until the last page. */
function pagedSite(total: number) {
  let page = 0;
  const calls: string[] = [];
  const run = vi.fn(async (call: ToolCall) => {
    calls.push(call.name);
    if (call.name === 'click') { page++; return { ok: true }; }
    const start = page * 50 + 1, end = Math.min(total, start + 49);
    return { ok: true, extracted: { kind: 'rows', source: 'jobs?p=' + page, rows: rows(start, end), range: [start, end], claimed: total, ...(end < total ? { nextRef: '@e9' } : {}) } };
  });
  return { run, calls };
}

it('pages through a list to the target and resumes from the saved collection', async () => {
  const site = pagedSite(400);
  let t = 0;
  const first = await bridgeCollect(1, { mode: 'rows', target: 200 }, { run: site.run, now: () => t, newId: () => 'c1' });
  expect(first).toMatchObject({ ok: true, collectionId: 'c1', complete: true, stopReason: 'complete', saved: 200, target: 200, nextSince: 200 });
  expect(site.calls.filter(n => n === 'click')).toHaveLength(3);
  expect((first.rows as unknown[])).toHaveLength(200);
  const again = await bridgeCollect(1, { mode: 'rows', collectionId: 'c1', since: 200 }, { run: site.run, now: () => t });
  expect(again).toMatchObject({ complete: true, saved: 200, rows: [] });
  t++;
});

it('reports the actual count when the site has fewer records than requested', async () => {
  const site = pagedSite(180);
  const res = await bridgeCollect(1, { mode: 'rows', target: 200 }, { run: site.run, newId: () => 'c2' });
  expect(res).toMatchObject({ complete: true, saved: 180, target: 180, claimed: 180 });
  expect(String(res.progress)).toContain('the page claims only 180');
});

it('stops at the time budget and continues on the next call', async () => {
  const site = pagedSite(400);
  let t = 0;
  const run = vi.fn(async (call: ToolCall) => { t += 2_500; return site.run(call); });
  const first = await bridgeCollect(1, { mode: 'rows', target: 400 }, { run, now: () => t, newId: () => 'c3' });
  expect(first).toMatchObject({ complete: false, stopReason: 'deadline' });
  const saved = first.saved as number;
  expect(saved).toBeGreaterThan(0);
  expect(saved).toBeLessThan(400);
  let res = first;
  for (let i = 0; i < 10 && !res.complete; i++) res = await bridgeCollect(1, { mode: 'rows', collectionId: 'c3', since: res.nextSince }, { run, now: () => t });
  expect(res).toMatchObject({ complete: true, saved: 400 });
});

it('rechecks a stalled infinite list once, then says where loading stopped', async () => {
  const names: string[] = [];
  const run = vi.fn(async (call: ToolCall) => {
    names.push(call.name);
    if (call.name !== 'extract') return { ok: true };
    return { ok: true, extracted: { kind: 'rows', source: 'feed', rows: rows(1, 40), scrollBy: 600 } };
  });
  const res = await bridgeCollect(1, { mode: 'rows', target: 200 }, { run, newId: () => 'c4' });
  expect(names).toEqual(['extract', 'scroll', 'extract', 'wait', 'extract']);
  expect(res).toMatchObject({ complete: false, stopReason: 'stalled', saved: 40 });
  expect(String(res.progress)).toContain('loading stopped at 40/200');
});

it('reads a long article to the end and records the section reached', async () => {
  const full = 'A'.repeat(5000) + '\n\n' + 'B'.repeat(5000) + '\n\n' + 'C'.repeat(3000);
  const run = vi.fn(async (call: ToolCall) => {
    const offset = Number(call.arguments.offset ?? 0);
    const end = Math.min(full.length, offset + 5002);
    return { ok: true, extracted: { kind: 'chunk', source: 'article', revision: 'r1', offset, total: full.length, text: full.slice(offset, end), heading: end >= full.length ? 'Conclusion' : 'Middle' } };
  });
  const res = await bridgeCollect(1, { mode: 'chunk' }, { run, newId: () => 'c5' });
  expect(res).toMatchObject({ complete: true, stopReason: 'complete', saved: full.length, total: full.length, position: 'Conclusion' });
  expect(res.text).toBe(full);
});

it('captures once without a target and rejects bad input', async () => {
  const site = pagedSite(400);
  const res = await bridgeCollect(1, { mode: 'rows' }, { run: site.run, newId: () => 'c6' });
  expect(res).toMatchObject({ complete: false, stopReason: 'single_capture', saved: 50 });
  expect(site.calls).toEqual(['extract']);
  await expect(bridgeCollect(1, { mode: 'list' }, { run: site.run })).rejects.toThrow('mode');
  await expect(bridgeCollect(1, { mode: 'rows', target: 0 }, { run: site.run })).rejects.toThrow('target');
  await expect(bridgeCollect(1, { mode: 'rows', collectionId: 'missing' }, { run: site.run })).rejects.toThrow('Unknown');
  await expect(bridgeCollect(2, { mode: 'rows', collectionId: 'c6' }, { run: site.run })).rejects.toThrow('tab 1');
  await expect(bridgeCollect(1, { mode: 'chunk', collectionId: 'c6' }, { run: site.run })).rejects.toThrow('mode "rows"');
});
