import type { ToolCall } from './types';

const LOOP_GUARD_WINDOW = 8;
const MAX_CYCLE_LENGTH = 4;

// The cycle check above only fires on an identical call while the page stays put, so it misses
// the two ways a run actually spins: scrolling a page over and over looking for content that is
// not in the snapshot, and touring the same handful of URLs — each navigation "changes the page"
// and resets the cycle state. These two bound both.
const REVISIT_LIMIT = 3;
const SCROLL_RUN_LIMIT = 3;

// Consecutive scrolls are only half the story: alternating scroll → extract → scroll resets the
// run counter every time, so a page can be scrolled dozens of times while never tripping it.
const SCROLL_TOTAL_LIMIT = 6;

// Short results repeat legitimately — "ok", an empty match list, a status line. Only dedupe
// payloads big enough that re-reading them is a real waste of a step and of context.
const MIN_DEDUPE_CHARS = 200;

// Revisits are keyed on the exact URL, so re-querying one API endpoint with cosmetically
// different parameters never registers: ?url=X&limit=1 and ?url=X&output=text are different
// strings pursuing the same thing. Counting the endpoint itself bounds that.
const ENDPOINT_LIMIT = 5;

// …except the two ways one path is *supposed* to be revisited: pagination walks it with a rising
// index, and a search endpoint is revisited with a new question every time. Counting searches as
// circling blocked the agent's main discovery tool — six distinct DuckDuckGo queries were once
// refused as "only the query string changing", which is exactly what a search is.
const PAGINATION_PARAMS = ['page', 'pagenumber', 'offset', 'start', 'skip', 'pg'];
const SEARCH_PARAMS = ['q', 'query', 'search', 'search_query', 'keyword', 'keywords', 'text', 'wd'];

export interface LoopGuardState {
  noEffectSignatures: string[];
  /** How many times a (url, tool, ref) triple has been attempted across the whole task. */
  visits: Record<string, number>;
  /** Consecutive scrolls on one URL. */
  scrollRun: { url: string; count: number };
  /** Scrolls on each URL across the whole task, however they were interleaved. */
  scrollTotals: Record<string, number>;
  /** Navigations to each origin+path, ignoring the query string. */
  endpointVisits: Record<string, number>;
  /** Fingerprint of every sizable result already handed to the model. */
  seenResults: Record<string, { step: number; tool: string; chars: number }>;
}

export interface LoopGuardDecision {
  blocked: boolean;
  cycleLength: number;
  noEffectActions: number;
}

export function createLoopGuardState(): LoopGuardState {
  return {
    noEffectSignatures: [],
    visits: {},
    scrollRun: { url: '', count: 0 },
    scrollTotals: {},
    endpointVisits: {},
    seenResults: {},
  };
}

/**
 * Did this call just hand back content the model already has?
 *
 * The visit counter above only sees repeated *attempts*, so four identical extracts of one page
 * read as progress until the third trips the limit. Watching the *results* catches it on the
 * first repeat, which is the difference between spending one wasted step and spending four —
 * each of them re-sending the whole payload through the model.
 */
export function detectRepeatedResult(
  state: LoopGuardState,
  call: ToolCall,
  content: string,
  stepIndex: number,
): string | null {
  if (content.length < MIN_DEDUPE_CHARS) return null;

  const key = fingerprint(content);
  const seen = state.seenResults[key];
  if (!seen) {
    state.seenResults[key] = { step: stepIndex, tool: call.name, chars: content.length };
    return null;
  }

  const origin = seen.tool === call.name ? `at step ${seen.step}` : `from ${seen.tool} at step ${seen.step}`;
  return `You already have this. ${call.name} returned exactly the content you got ${origin} — ${content.length} characters, unchanged. Reading it again cannot add anything. Answer from the evidence you already collected, or go somewhere genuinely new.`;
}

/**
 * Records this attempt and returns a corrective message when the agent is going in circles:
 * the same action on the same page for the third time, or a long run of scrolling that keeps
 * not finding anything. Returns null while the run still looks like progress.
 */
export function detectRepeatedVisit(state: LoopGuardState, url: string, call: ToolCall): string | null {
  if (call.name === 'scroll') {
    state.scrollRun = state.scrollRun.url === url
      ? { url, count: state.scrollRun.count + 1 }
      : { url, count: 1 };
    const total = (state.scrollTotals[url] ?? 0) + 1;
    state.scrollTotals[url] = total;
    if (state.scrollRun.count > SCROLL_RUN_LIMIT) {
      return `Loop detected: ${state.scrollRun.count} scrolls in a row on ${url} without finding the content. It is probably not in the accessibility snapshot at all — often a widget inside an iframe. Stop scrolling: extract what is visible, open the underlying page directly, or look for the data on another site.`;
    }
    if (total > SCROLL_TOTAL_LIMIT) {
      return `Loop detected: ${total} scrolls on ${url} across this task. Scrolling is not revealing anything new here. Use extract with refs="all" to take the whole document body in one call, then work from that text instead of paging through the viewport.`;
    }
    return null;
  }

  state.scrollRun = { url: '', count: 0 };

  if (call.name === 'navigate' || call.name === 'open_tab') {
    const endpoint = endpointKey(String(call.arguments.url ?? ''));
    if (endpoint) {
      const hits = (state.endpointVisits[endpoint] ?? 0) + 1;
      state.endpointVisits[endpoint] = hits;
      if (hits > ENDPOINT_LIMIT) {
        return `Loop detected: ${hits} requests to ${endpoint} with only the query string changing. Rewriting one endpoint's parameters is not getting you closer — answer from the pages you already loaded, or find the data on a different site.`;
      }
    }
  }

  const ref = typeof call.arguments.ref === 'string' ? call.arguments.ref : '';
  const target = call.name === 'navigate' || call.name === 'open_tab'
    ? String(call.arguments.url ?? '')
    : ref;
  const key = `${url}|${call.name}|${target}`;
  const count = (state.visits[key] ?? 0) + 1;
  state.visits[key] = count;

  if (count > REVISIT_LIMIT) {
    const label = target ? `${call.name}(${target})` : call.name;
    return `Loop detected: ${label} has already been tried ${count - 1} times on this page and did not get you closer. Revisiting it again will not help — extract the evidence you already have, or take a different route entirely.`;
  }
  return null;
}

export function isLoopGuardEligible(call: ToolCall): boolean {
  return call.name !== 'done' && call.name !== 'set_task_plan';
}

export function toolCallSignature(call: ToolCall): string {
  return `${call.name}:${stableStringify(call.arguments)}`;
}

export function detectLoopGuardCycle(state: LoopGuardState, nextSignature: string): LoopGuardDecision {
  const sequence = [...state.noEffectSignatures, nextSignature];
  const maxCycleLength = Math.min(MAX_CYCLE_LENGTH, Math.floor(sequence.length / 2));

  for (let cycleLength = 1; cycleLength <= maxCycleLength; cycleLength++) {
    const noEffectActions = cycleLength === 1 ? 3 : cycleLength * 2;
    if (sequence.length < noEffectActions) continue;

    const suffix = sequence.slice(-noEffectActions);
    const pattern = suffix.slice(0, cycleLength);
    const repeats = suffix.every((signature, index) => signature === pattern[index % cycleLength]);
    if (repeats) {
      return { blocked: true, cycleLength, noEffectActions };
    }
  }

  return { blocked: false, cycleLength: 0, noEffectActions: 0 };
}

export function recordLoopGuardOutcome(
  state: LoopGuardState,
  signature: string,
  changedPage: boolean,
): void {
  if (changedPage) {
    state.noEffectSignatures = [];
    return;
  }

  state.noEffectSignatures.push(signature);
  if (state.noEffectSignatures.length > LOOP_GUARD_WINDOW) {
    state.noEffectSignatures.splice(0, state.noEffectSignatures.length - LOOP_GUARD_WINDOW);
  }
}

/**
 * What counts as "the same destination" for the revisit counter.
 *
 * Pagination is exempt outright: walking one path with a rising index is the point.
 *
 * Searching is not exempt, it is keyed by the question. Exempting search endpoints wholesale was
 * the obvious fix for refusing six distinct DuckDuckGo queries, and it opened a hole immediately:
 * Bing Maps and Nominatim also search through `q`, so a run hit them thirty times with five
 * cosmetic variants of one question — "gym", "gyms", "fitness", and `fitness%20centre` and
 * `fitness+centre`, which are the same string twice. Keying on the normalized term keeps genuinely
 * different questions unlimited while the same question asked again counts as the revisit it is.
 */
function endpointKey(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  let searchTerm: string | null = null;
  for (const [key, value] of parsed.searchParams.entries()) {
    const name = key.toLowerCase();
    if (PAGINATION_PARAMS.includes(name)) return null;
    if (searchTerm === null && SEARCH_PARAMS.includes(name)) searchTerm = normalizeQuery(value);
  }

  const base = `${parsed.origin}${parsed.pathname}`;
  return searchTerm === null ? base : `${base}?${searchTerm}`;
}

/** So that `fitness%20centre`, `fitness+centre` and `Fitness Centre` are one question, not three. */
function normalizeQuery(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    // Malformed escapes: compare what we were given rather than dropping the term entirely.
  }
  return decoded.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Cheap content fingerprint — length plus a djb2 hash, enough to key exact repeats. */
function fingerprint(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0;
  }
  return `${content.length}:${hash.toString(36)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }

  return JSON.stringify(value) ?? String(value);
}
