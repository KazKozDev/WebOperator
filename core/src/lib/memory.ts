import type { ToolCall } from './types';

// ── Memory types ─────────────────────────────────────────────────────
export interface SiteMemory {
  urlPattern: string;
  lastVisited: number;
  hits: number;
  commonRefs: string[];          // refs that often work (like @e10 for search)
  navHints: string[];            // navigation patterns
  popupRefs: string[];           // known popup close buttons
  failures: string[];            // what failed and why
  successTips: string[];         // what works well
}

export interface AgentMemory {
  version: 1;
  sites: Record<string, SiteMemory>;  // url pattern → site memory
  recentWins: string[];               // last 5 successful task summaries
  recentLosses: string[];             // last 5 failure reasons
  learnedHints: string[];             // cross-site tips
  updatedAt: number;
}

// ── Default empty memory ─────────────────────────────────────────────
function emptyMemory(): AgentMemory {
  return {
    version: 1,
    sites: {},
    recentWins: [],
    recentLosses: [],
    learnedHints: [],
    updatedAt: Date.now(),
  };
}

// ── URL pattern extraction ───────────────────────────────────────────
export function siteKey(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0]?.replace(/^www\./, '') || url;
  }
}

// ── Load / Save ──────────────────────────────────────────────────────
const STORAGE_KEY = 'agent_memory';

export async function loadMemory(): Promise<AgentMemory> {
  try {
    const raw = await chrome.storage.local.get(STORAGE_KEY);
    const data = raw[STORAGE_KEY];
    if (data && data.version === 1 && data.sites) return data as AgentMemory;
  } catch { /* ignore */ }
  return emptyMemory();
}

export async function saveMemory(mem: AgentMemory): Promise<void> {
  mem.updatedAt = Date.now();
  await chrome.storage.local.set({ [STORAGE_KEY]: mem });
}

// ── Prune old entries ────────────────────────────────────────────────
function pruneMemory(mem: AgentMemory): void {
  // Keep last 5 wins/losses
  if (mem.recentWins.length > 5) mem.recentWins = mem.recentWins.slice(-5);
  if (mem.recentLosses.length > 5) mem.recentLosses = mem.recentLosses.slice(-5);
  // Keep last 10 learned hints
  if (mem.learnedHints.length > 10) mem.learnedHints = mem.learnedHints.slice(-10);
  // Remove sites not visited in 30 days and with no successes
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const [key, site] of Object.entries(mem.sites)) {
    if (site.lastVisited < cutoff && site.hits === 0) {
      delete mem.sites[key];
    }
  }
  // Keep max 50 sites
  const entries = Object.entries(mem.sites).sort((a, b) => b[1].lastVisited - a[1].lastVisited);
  if (entries.length > 50) {
    mem.sites = Object.fromEntries(entries.slice(0, 50));
  }
}

// ── Learn from a completed task ──────────────────────────────────────
export async function learnFromTask(
  url: string,
  goal: string,
  success: boolean,
  summary: string,
  steps: { toolCall?: ToolCall; result?: { ok: boolean; error?: string }; note?: string }[],
): Promise<void> {
  const mem = await loadMemory();
  const key = siteKey(url);
  const site = mem.sites[key] ?? {
    urlPattern: key,
    lastVisited: 0,
    hits: 0,
    commonRefs: [],
    navHints: [],
    popupRefs: [],
    failures: [],
    successTips: [],
  };

  site.lastVisited = Date.now();

  if (success) {
    site.hits++;
    mem.recentWins.push(`[${key}] ${goal}: ${summary.slice(0, 200)}`);
    // Learn from successful steps
    for (const step of steps) {
      if (!step.toolCall) continue;
      const ref = String(step.toolCall.arguments.ref ?? '');
      if (ref && !site.commonRefs.includes(ref)) {
        site.commonRefs.push(ref);
        if (site.commonRefs.length > 10) site.commonRefs.shift();
      }
      // Detect popup closings
      if (step.toolCall.name === 'click' && step.note?.includes('popup')) {
        if (ref && !site.popupRefs.includes(ref)) {
          site.popupRefs.push(ref);
          if (site.popupRefs.length > 5) site.popupRefs.shift();
        }
      }
      // Detect navigation patterns
      if (step.toolCall.name === 'navigate') {
        const navUrl = String(step.toolCall.arguments.url ?? '');
        if (navUrl && !site.navHints.includes(navUrl)) {
          site.navHints.push(navUrl);
          if (site.navHints.length > 5) site.navHints.shift();
        }
      }
    }
    // Collect success tips
    const tip = steps.find(s => s.result?.ok && s.note)?.note;
    if (tip && !site.successTips.includes(tip)) {
      site.successTips.push(tip);
      if (site.successTips.length > 5) site.successTips.shift();
    }
  } else {
    mem.recentLosses.push(`[${key}] ${goal}: ${summary.slice(0, 200)}`);
    // Learn from failures
    for (const step of steps) {
      if (step.result?.error && !site.failures.includes(step.result.error)) {
        site.failures.push(step.result.error);
        if (site.failures.length > 5) site.failures.shift();
      }
    }
    // Cross-site hint from failure
    const lastError = steps.filter(s => !s.result?.ok).slice(-1)[0]?.result?.error;
    if (lastError && !mem.learnedHints.includes(lastError)) {
      mem.learnedHints.push(lastError);
    }
  }

  mem.sites[key] = site;
  pruneMemory(mem);
  await saveMemory(mem);
}

// ── Build context prompt from memory ─────────────────────────────────
export async function memoryContext(url: string): Promise<string> {
  const mem = await loadMemory();
  const key = siteKey(url);
  const site = mem.sites[key];

  const parts: string[] = [];

  if (site && site.hits > 0) {
    parts.push(`[MEMORY: ${key}]`);
    parts.push(`Previously visited ${site.hits} times.`);

    if (site.commonRefs.length > 0) {
      parts.push(`Known refs: ${site.commonRefs.slice(0, 5).join(', ')}`);
    }
    if (site.popupRefs.length > 0) {
      parts.push(`Known popup close buttons: ${site.popupRefs.join(', ')}`);
    }
    if (site.successTips.length > 0) {
      parts.push(`Tips: ${site.successTips.slice(-2).join('; ')}`);
    }
    if (site.failures.length > 0) {
      parts.push(`Previous failures to avoid: ${site.failures.slice(-3).join('; ')}`);
    }
  }

  if (mem.learnedHints.length > 0) {
    parts.push(`[CROSS-SITE TIPS] ${mem.learnedHints.slice(-3).join(' | ')}`);
  }

  return parts.join('\n');
}
