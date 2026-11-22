import { describe, expect, it } from 'vitest';
import { applyBatch, chunkEnd, collectionFollowUp, compactRows, incomplete, lastHeadingBefore, mergeCollection, parseRange, progress, type Collection } from './collection';
const fresh = (): Collection => ({ rows: [], pages: [], documents: [] });
const rows = (first: number, last: number) => Array.from({ length: last-first+1 }, (_, i) => ({key: String(first+i), text: 'Item ' + (first+i)}));
describe('persistent collection', () => {
  it('counts four pages, retries, and overlapping windows without inflating the target', () => {
    const c = fresh();
    c.target = 200;
    for (let start = 1; start <= 151; start += 50) {
      for (const shift of [0, 0, 20]) {
        mergeCollection(c, { kind: 'rows', source: 'inbox', range: [start, start+49], rows: rows(start+shift,start+shift+29) });
      }
    }
    expect(c.rows).toHaveLength(200);
    expect(incomplete(c)).toBe(false);
    expect(c.pages).toHaveLength(4);
  });
  it('retains a partial page across serialization and reports the shortfall', () => {
    const c = fresh();
    c.target = 200;
    mergeCollection(c, {kind:'rows', source:'inbox', range:[1,50], rows: rows(1,44)});
    const restored = JSON.parse(JSON.stringify(c));
    expect(progress(restored)).toContain('44/200');
    expect(incomplete(restored)).toBe(true);
  });
  it('resumes contiguous text, ignores retries and restarts a changed revision', () => {
    const c = fresh();
    const chunk = {kind:'chunk' as const, source:'article',revision:'1',offset:0,total:14000,text:'a'.repeat(6000)};
    mergeCollection(c,chunk);
    mergeCollection(c,chunk);
    expect(incomplete(c)).toBe(true);
    mergeCollection(c,{...chunk,offset:6000});
    mergeCollection(c,{...chunk,offset:12000,text:'b'.repeat(2000)});
    expect(incomplete(c)).toBe(false);
    expect(c.documents[0].text).toHaveLength(14000);
    mergeCollection(c,{...chunk,revision:'2'});
    expect(c.documents[0].text).toHaveLength(6000);
  });
});

describe('collection traversal', () => {
  it('holds a later page until the preceding range has been collected', () => {
    const c = fresh();
    c.target = 200;
    mergeCollection(c, { kind: 'rows', source:'p1', range:[1,50], rows:rows(1,44) });
    expect(() => mergeCollection(c, { kind:'rows', source:'p2', range:[51,100], rows:rows(51,100) })).toThrow('row 1');
    expect(c.rows.length).toBe(44);
  });
  it('scrolls to fill a partially loaded page before following Next', () => {
    const c = fresh();
    c.target = 200;
    const read = {name:'extract' as const,arguments:{refs:'rows',target:200}};
    const batch = {kind:'rows' as const, source:'inbox', range:[1,50] as [number,number], rows:rows(1,44), nextRef:'@e2', scrollBy:240};
    mergeCollection(c,batch);
    expect(collectionFollowUp(c,batch,read,true).map(c=>c.name)).toEqual(['scroll','extract']);
    mergeCollection(c,{...batch,rows:rows(45,50)});
    expect(collectionFollowUp(c,batch,read,true).map(c=>c.name)).toEqual(['click','extract']);
  });
});

describe('page ranges', () => {
  it('reads the shown range and the claimed total, with thousands separators', () => {
    expect(parseRange('1–50 of 1,234')).toEqual({ range: [1, 50], claimed: 1234 });
    expect(parseRange('51 - 100 из 2 345')).toEqual({ range: [51, 100], claimed: 2345 });
    expect(parseRange('Showing 4 of 9 entries')).toBeUndefined();
    expect(parseRange('1–50 of 30')).toBeUndefined();
  });
  it('stops at the total the page claims when it is below the request', () => {
    const c = fresh();
    c.target = 200;
    const read = {name:'extract' as const,arguments:{refs:'rows',target:200}};
    for (const [start, end] of [[1, 50], [51, 100], [101, 150], [151, 180]]) {
      const batch = { kind:'rows' as const, source:'jobs', range:[start, end] as [number, number], claimed: 180, rows: rows(start, end), nextRef: '@e9' };
      mergeCollection(c, batch);
      if (end < 180) expect(collectionFollowUp(c, batch, read, true).map(x => x.name)).toEqual(['click', 'extract']);
      else expect(collectionFollowUp(c, batch, read, true)).toEqual([]);
    }
    expect(c.rows).toHaveLength(180);
    expect(incomplete(c)).toBe(false);
    expect(progress(c)).toContain('180/180 unique rows saved (requested 200; the page claims only 180)');
  });
  it('never turns a claimed total into a goal the user did not ask for', () => {
    const c = fresh();
    const batch = { kind:'rows' as const, source:'inbox', range:[1, 50] as [number, number], claimed: 2345, rows: rows(1, 50), nextRef: '@e2' };
    mergeCollection(c, batch);
    expect(collectionFollowUp(c, batch, {name:'extract',arguments:{refs:'rows'}}, true)).toEqual([]);
    expect(incomplete(c)).toBe(false);
  });
});

describe('infinite scroll', () => {
  it('rechecks once when a scroll adds nothing, then reports the actual count', () => {
    const c = fresh();
    c.target = 200;
    const read = {name:'extract' as const,arguments:{refs:'rows',target:200}};
    const batch = { kind:'rows' as const, source:'feed', rows: rows(1, 40), scrollBy: 600 };
    mergeCollection(c, batch);
    expect(collectionFollowUp(c, batch, read, true).map(x => x.name)).toEqual(['scroll', 'extract']);
    const recheck = collectionFollowUp(c, batch, read, false);
    expect(recheck.map(x => x.name)).toEqual(['wait', 'extract']);
    expect(c.stalled).toBeFalsy();
    expect(collectionFollowUp(c, batch, read, false)).toEqual([]);
    expect(c.stalled).toBe(true);
    expect(incomplete(c)).toBe(true);
    expect(progress(c)).toContain('loading stopped at 40/200');
  });
  it('moves on instead of rechecking when nothing moved before the re-read', () => {
    const c = fresh();
    c.target = 200;
    const read = {name:'extract' as const,arguments:{refs:'rows',target:200}};
    const page = { kind:'rows' as const, source:'p1', range:[1,50] as [number,number], rows: rows(1, 50), nextRef: '@e2' };
    mergeCollection(c, page);
    expect(collectionFollowUp(c, page, read, false, false).map(x => x.name)).toEqual(['click', 'extract']);
    const feed = { kind:'rows' as const, source:'feed', rows: rows(51, 60), scrollBy: 600 };
    mergeCollection(c, feed);
    expect(collectionFollowUp(c, feed, read, false, false).map(x => x.name)).toEqual(['scroll', 'extract']);
    expect(c.rechecked).toBeFalsy();
  });
  it('clears the stall once new records arrive', () => {
    const c = fresh();
    c.target = 200;
    const read = {name:'extract' as const,arguments:{refs:'rows',target:200}};
    const batch = { kind:'rows' as const, source:'feed', rows: rows(1, 40), scrollBy: 600 };
    mergeCollection(c, batch);
    collectionFollowUp(c, batch, read, false);
    collectionFollowUp(c, batch, read, false);
    mergeCollection(c, { ...batch, rows: rows(41, 80) });
    expect(collectionFollowUp(c, batch, read, true).map(x => x.name)).toEqual(['scroll', 'extract']);
    expect(c.stalled).toBe(false);
    expect(progress(c)).not.toContain('loading stopped');
  });
});

describe('long text', () => {
  const para = (n: number, len: number) => `Section ${n}\n\n` + 'w'.repeat(len) + '\n\n';
  it('ends a chunk on a paragraph break and never returns an empty chunk', () => {
    const full = para(1, 3500) + para(2, 3500) + para(3, 3500);
    const first = chunkEnd(full, 0);
    expect(full.slice(first - 2, first)).toBe('\n\n');
    expect(first).toBeLessThanOrEqual(6000);
    let offset = 0, reads = 0;
    while (offset < full.length) {
      const end = chunkEnd(full, offset);
      expect(end).toBeGreaterThan(offset);
      offset = end;
      reads++;
    }
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(chunkEnd('x'.repeat(9000), 0)).toBe(6000);
  });
  it('records the section it reached', () => {
    const full = para(1, 3500) + para(2, 3500) + para(3, 3500);
    const headings = ['Section 1', 'Section 2', 'Section 3'];
    const end = chunkEnd(full, 0);
    expect(lastHeadingBefore(full, headings, end)).toBe('Section 2');
    expect(lastHeadingBefore(full, headings, full.length)).toBe('Section 3');
    const c = fresh();
    mergeCollection(c, { kind:'chunk', source:'article', revision:'1', offset:0, total:full.length, text:full.slice(0, end), heading:'Section 2' });
    expect(progress(c)).toContain(`${end}/${full.length} characters saved, reached "Section 2"`);
    mergeCollection(c, { kind:'chunk', source:'article', revision:'1', offset:end, total:full.length, text:full.slice(end), heading:'Section 3' });
    expect(incomplete(c)).toBe(false);
    expect(progress(c)).toContain('reached "Section 3"');
  });
});

describe('target and model view', () => {
  it('raises a target that was set to the page size', () => {
    const c = fresh();
    const page = { kind:'rows' as const, source:'search', range:[1,25] as [number,number], claimed: 5981, rows: rows(1, 25), nextRef: '@e4' };
    expect(applyBatch(c, page, {name:'extract',arguments:{refs:'rows',target:25}})).toEqual([]);
    expect(c.target).toBe(25);
    const next = applyBatch(c, page, {name:'extract',arguments:{refs:'rows',target:50}}, false);
    expect(c.target).toBe(50);
    expect(next.map(x => x.name)).toEqual(['click', 'extract']);
    expect(applyBatch(c, page, {name:'extract',arguments:{refs:'rows',target:10}}, false).length).toBe(2);
    expect(c.target).toBe(50);
  });
  it('gives the model one short line per new row', () => {
    const long = { key: 'k', text: 'arXiv:2611.26531  [pdf]\n  Cost-Aware Agentic Feature Optimization\n' + 'abstract '.repeat(200) };
    const view = compactRows({ kind:'rows', source:'search', range:[1,25], claimed: 5981, rows: [long, { ...long, key: 'old' }, { ...long, key: 'extra' }] }, [long], new Set(['old']));
    expect(view).toMatchObject({ range: [1, 25], claimed: 5981, alreadySaved: 1, beyondTarget: 1 });
    const [line] = view.newRows as string[];
    expect(line.length).toBe(200);
    expect(line).toContain('Cost-Aware Agentic Feature Optimization');
    expect(line).not.toContain('\n');
  });
});
