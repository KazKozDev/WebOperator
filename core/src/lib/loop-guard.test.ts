import { describe, expect, it } from 'vitest';
import {
  createLoopGuardState,
  detectLoopGuardCycle,
  detectRepeatedResult,
  detectRepeatedVisit,
  recordLoopGuardOutcome,
  toolCallSignature,
} from './loop-guard';
import type { ToolCall } from './types';

function call(name: ToolCall['name'], args: Record<string, unknown>): ToolCall {
  return { name, arguments: args };
}

function recordNoEffect(state: ReturnType<typeof createLoopGuardState>, toolCall: ToolCall): string {
  const signature = toolCallSignature(toolCall);
  recordLoopGuardOutcome(state, signature, false);
  return signature;
}

describe('loop guard', () => {
  it('blocks the third identical no-effect call', () => {
    const state = createLoopGuardState();
    const click = call('click', { ref: '@e1' });
    const signature = recordNoEffect(state, click);
    recordLoopGuardOutcome(state, signature, false);

    expect(detectLoopGuardCycle(state, signature)).toEqual({
      blocked: true,
      cycleLength: 1,
      noEffectActions: 3,
    });
  });

  it('blocks an alternating two-action no-effect cycle', () => {
    const state = createLoopGuardState();
    const clickA = call('click', { ref: '@e1' });
    const clickB = call('click', { ref: '@e2' });
    const signatureA = recordNoEffect(state, clickA);
    const signatureB = recordNoEffect(state, clickB);
    recordLoopGuardOutcome(state, signatureA, false);

    expect(detectLoopGuardCycle(state, signatureB)).toEqual({
      blocked: true,
      cycleLength: 2,
      noEffectActions: 4,
    });
  });

  it('blocks a three-action no-effect cycle', () => {
    const state = createLoopGuardState();
    const signatures = [
      recordNoEffect(state, call('click', { ref: '@e1' })),
      recordNoEffect(state, call('scroll', { direction: 'down' })),
      recordNoEffect(state, call('wait', { ms: 1000 })),
    ];
    for (const signature of signatures.slice(0, 2)) {
      recordLoopGuardOutcome(state, signature, false);
    }

    expect(detectLoopGuardCycle(state, signatures[2])).toEqual({
      blocked: true,
      cycleLength: 3,
      noEffectActions: 6,
    });
  });

  it('does not block non-repeating no-effect actions', () => {
    const state = createLoopGuardState();
    recordNoEffect(state, call('click', { ref: '@e1' }));
    recordNoEffect(state, call('click', { ref: '@e2' }));
    recordNoEffect(state, call('scroll', { direction: 'down' }));

    const decision = detectLoopGuardCycle(state, toolCallSignature(call('wait', { ms: 1000 })));

    expect(decision.blocked).toBe(false);
  });

  it('clears no-effect history after a successful page-changing action', () => {
    const state = createLoopGuardState();
    const signature = recordNoEffect(state, call('click', { ref: '@e1' }));
    recordLoopGuardOutcome(state, signature, false);
    recordLoopGuardOutcome(state, signature, true);

    expect(detectLoopGuardCycle(state, signature).blocked).toBe(false);
  });

  it('normalizes argument key order in signatures', () => {
    expect(toolCallSignature(call('type', { ref: '@e1', text: 'hello' })))
      .toBe(toolCallSignature(call('type', { text: 'hello', ref: '@e1' })));
  });

  it('blocks touring the same page over and over across navigations', () => {
    const state = createLoopGuardState();
    const url = 'https://www.philamuseum.org/tickets?keyword=Admission';
    const click = call('click', { ref: '@e22' });
    // The cycle check never sees this: every navigation in between "changes the page".
    expect(detectRepeatedVisit(state, url, click)).toBeNull();
    expect(detectRepeatedVisit(state, 'https://www.philamuseum.org/faq', call('click', { ref: '@e3' }))).toBeNull();
    expect(detectRepeatedVisit(state, url, click)).toBeNull();
    expect(detectRepeatedVisit(state, url, click)).toBeNull();
    expect(detectRepeatedVisit(state, url, click)).toContain('already been tried');
  });

  it('blocks a long scroll run and points at the iframe case', () => {
    const state = createLoopGuardState();
    const url = 'https://www.philamuseum.org/members';
    const scroll = (amountPx: number) => call('scroll', { amountPx, direction: amountPx > 0 ? 'down' : 'up' });
    // Different amounts each time, so every signature differs and the cycle check stays quiet.
    for (const amount of [600, -600, -800]) {
      expect(detectRepeatedVisit(state, url, scroll(amount))).toBeNull();
    }
    expect(detectRepeatedVisit(state, url, scroll(-1200))).toContain('scrolls in a row');
  });

  it('lets an interrupted scroll run start over', () => {
    const state = createLoopGuardState();
    const scroll = call('scroll', { amountPx: 600, direction: 'down' });
    for (let i = 0; i < 3; i++) expect(detectRepeatedVisit(state, 'https://a.example', scroll)).toBeNull();
    expect(detectRepeatedVisit(state, 'https://a.example', call('click', { ref: '@e1' }))).toBeNull();
    expect(detectRepeatedVisit(state, 'https://a.example', scroll)).toBeNull();
  });
});

describe('detectRepeatedResult', () => {
  const page = 'x'.repeat(400);

  it('stays quiet the first time content is seen', () => {
    const state = createLoopGuardState();
    expect(detectRepeatedResult(state, call('extract', { refs: 'all' }), page, 5)).toBeNull();
  });

  it('flags the very first repeat and names the step that already has it', () => {
    // The regression this guards: one AssistantBench page was extracted four times, byte for
    // byte, and every repeat read as progress until the visit counter finally tripped.
    const state = createLoopGuardState();
    const extract = call('extract', { refs: 'all' });
    expect(detectRepeatedResult(state, extract, page, 5)).toBeNull();

    const message = detectRepeatedResult(state, extract, page, 9);
    expect(message).toContain('step 5');
    expect(message).toContain('400 characters');
  });

  it('names the other tool when a different call returns the same content', () => {
    const state = createLoopGuardState();
    expect(detectRepeatedResult(state, call('extract', { refs: 'all' }), page, 2)).toBeNull();
    expect(detectRepeatedResult(state, call('read_cells', {}), page, 7)).toContain('from extract at step 2');
  });

  it('ignores short results, which repeat for honest reasons', () => {
    const state = createLoopGuardState();
    expect(detectRepeatedResult(state, call('click', { ref: '@e1' }), 'ok', 1)).toBeNull();
    expect(detectRepeatedResult(state, call('click', { ref: '@e1' }), 'ok', 2)).toBeNull();
  });

  it('treats changed content as progress', () => {
    const state = createLoopGuardState();
    expect(detectRepeatedResult(state, call('extract', { refs: 'all' }), page, 1)).toBeNull();
    expect(detectRepeatedResult(state, call('extract', { refs: 'all' }), `${page}more`, 2)).toBeNull();
  });
});

describe('cumulative scroll limit', () => {
  it('catches scrolling that hides between other calls', () => {
    // Alternating scroll → extract → scroll resets the consecutive run every time, so the
    // per-URL total is what actually bounds a page being paged through 34 times.
    const state = createLoopGuardState();
    const scroll = call('scroll', { direction: 'down' });
    const url = 'https://a.example';

    let tripped: string | null = null;
    for (let i = 0; i < 7 && !tripped; i++) {
      tripped = detectRepeatedVisit(state, url, scroll);
      detectRepeatedVisit(state, url, call('extract', { refs: 'all' }));
    }

    expect(tripped).toContain('scrolls on https://a.example');
    expect(tripped).toContain('refs="all"');
  });
});

describe('endpoint churn', () => {
  const nav = (url: string) => call('navigate', { url });
  const page = 'https://a.example/list';

  it('catches one API endpoint being re-queried with cosmetic parameter changes', () => {
    // The regression this guards: 10 of 25 navigations went to web.archive.org/cdx/search/cdx,
    // each with a slightly different query, so the exact-URL revisit counter never fired.
    const state = createLoopGuardState();
    const cdx = 'https://web.archive.org/cdx/search/cdx';
    const queries = ['?url=a&limit=1', '?url=a&output=text', '?url=a&matchType=prefix', '?url=b', '?url=b&output=text'];
    for (const query of queries) {
      expect(detectRepeatedVisit(state, page, nav(`${cdx}${query}`))).toBeNull();
    }

    expect(detectRepeatedVisit(state, page, nav(`${cdx}?url=c&limit=9`)))
      .toContain('https://web.archive.org/cdx/search/cdx');
  });

  it('leaves real pagination alone', () => {
    const state = createLoopGuardState();
    for (let i = 1; i <= 9; i++) {
      expect(detectRepeatedVisit(state, page, nav(`https://a.example/results?page=${i}`))).toBeNull();
    }
  });

  it('leaves searching alone — a new question on one search endpoint is the point', () => {
    // The regression this guards: the endpoint counter refused six distinct DuckDuckGo searches
    // as "only the query string changing", which is precisely what running a search looks like.
    const state = createLoopGuardState();
    const queries = ['paintball Köln', 'paintball Cologne address', 'laser tag Köln', 'Köln Impressum', 'paintball NRW', 'Köln Adresse', 'paintball opening hours'];
    for (const q of queries) {
      expect(detectRepeatedVisit(state, page, nav(`https://duckduckgo.com/?q=${encodeURIComponent(q)}`))).toBeNull();
    }
  });

  it('counts distinct paths separately', () => {
    const state = createLoopGuardState();
    for (let i = 0; i < 5; i++) {
      expect(detectRepeatedVisit(state, page, nav(`https://a.example/one?q=${i}`))).toBeNull();
      expect(detectRepeatedVisit(state, page, nav(`https://a.example/two?q=${i}`))).toBeNull();
    }
  });
});

describe('search endpoints are keyed by the question, not exempted', () => {
  const nav = (url: string) => call('navigate', { url });
  const here = 'https://a.example/start';

  it('still lets distinct questions through', () => {
    const state = createLoopGuardState();
    const queries = ['paintball Köln', 'laser tag Köln', 'Köln Impressum', 'paintball NRW', 'opening hours', 'address'];
    for (const q of queries) {
      expect(detectRepeatedVisit(state, here, nav(`https://duckduckgo.com/?q=${encodeURIComponent(q)}`))).toBeNull();
    }
  });

  it('catches one question asked over and over at a map or geocoding endpoint', () => {
    // The regression this guards: exempting every `q=` URL let a run hit Bing Maps and Nominatim
    // thirty times with five cosmetic variants of the same question.
    // Each URL differs, so the plain revisit counter never sees a repeat — only the question is
    // the same, which is exactly how the real runs looked.
    const state = createLoopGuardState();
    const urls = [
      'https://nominatim.openstreetmap.org/search?format=json&q=gym',
      'https://nominatim.openstreetmap.org/search?format=jsonv2&q=gym',
      'https://nominatim.openstreetmap.org/search?format=json&limit=10&q=gym',
      'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=gym',
      'https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&q=gym',
    ];
    for (const url of urls) expect(detectRepeatedVisit(state, here, nav(url))).toBeNull();

    expect(detectRepeatedVisit(state, here, nav('https://nominatim.openstreetmap.org/search?format=json&bounded=1&q=gym')))
      .toContain('nominatim.openstreetmap.org/search');
  });

  it('treats the same term written differently as one question', () => {
    const state = createLoopGuardState();
    const variants = [
      'https://www.bing.com/maps/search?q=fitness%20centre',
      'https://www.bing.com/maps/search?q=fitness+centre',
      'https://www.bing.com/maps/search?q=Fitness+Centre',
      'https://www.bing.com/maps/search?q=fitness%20centre',
      'https://www.bing.com/maps/search?q=fitness+centre',
    ];
    for (const url of variants) expect(detectRepeatedVisit(state, here, nav(url))).toBeNull();

    expect(detectRepeatedVisit(state, here, nav(variants[0]))).toContain('bing.com/maps/search');
  });
});
