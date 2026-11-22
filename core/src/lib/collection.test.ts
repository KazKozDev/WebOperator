import { describe, expect, it } from 'vitest';
import { collectionFollowUp, incomplete, mergeCollection, progress, type Collection } from './collection';
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
    expect(collectionFollowUp(c,batch,read,false)).toEqual([]);
  });
});
