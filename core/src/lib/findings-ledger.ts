import type { AgentTask } from './types';
import { EVIDENCE_TOOLS } from './partial-work';

/**
 * What the run has actually collected, kept where context compaction cannot reach it.
 *
 * The loop never puts an extraction payload into the conversation. A successful `extract`
 * pushes one line — "✓ extract — 12 item(s) extracted" — and the data itself lives only in
 * `task.steps[].result.extracted`. Until it scrolls out, the model can still read the values
 * off the page snapshot that preceded the call; two observations later that snapshot is
 * collapsed to a title and an element count, and the values are gone from its context for good.
 * An auto-resume finishes the job by replacing the whole history with a dozen 180-character
 * step lines.
 *
 * That is why a long sweep degrades into re-reading: the agent is not being stubborn, it has
 * genuinely lost what it found. `task.steps` survives all of it, so the ledger is a plain read
 * over the trace, re-rendered into every observation and carried across every resume.
 */

/** One thing the run found, in the order it was found. */
export interface Finding {
  stepIndex: number;
  tool: string;
  url?: string;
  text: string;
}

export interface FindingsLedger {
  findings: Finding[];
  /** Findings held in the trace but too old to fit the render budget. */
  omitted: number;
}

/**
 * Per-finding cap. Deliberately far above the 1200 characters `collectWork` uses for its
 * end-of-run summary: one extract over a message list is the whole list, and truncating it at
 * a summary's length is exactly the loss this module exists to prevent.
 */
const MAX_FINDING_CHARS = 2400;

/** Newest findings that may be rendered at all, before the character budget narrows it further. */
const MAX_FINDINGS = 80;

/** Share of the model's context budget the ledger may occupy. */
export const LEDGER_BUDGET_RATIO = 0.15;

/** Absolute ceiling, so a large cloud budget does not turn every observation into a data dump. */
const LEDGER_MAX_CHARS = 6000;

function stringifyExtracted(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function trim(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit)}…` : collapsed;
}

/** Characters of ledger this provider's context can afford. */
export function ledgerCharBudget(contextTokens: number): number {
  return Math.min(LEDGER_MAX_CHARS, Math.max(0, Math.round(contextTokens * LEDGER_BUDGET_RATIO * 4)));
}

/**
 * Read every finding out of the trace. Identical payloads collapse into one entry: re-reading
 * the same list is the failure mode this fixes, and listing it twice would make the ledger
 * reinforce it.
 */
export function collectFindings(task: Pick<AgentTask, 'steps'>): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const step of task.steps) {
    const tool = step.toolCall?.name;
    if (!tool || !EVIDENCE_TOOLS.has(tool)) continue;
    if (step.result?.ok === false) continue;

    const text = trim(stringifyExtracted(step.result?.extracted), MAX_FINDING_CHARS);
    if (!text) continue;

    const key = `${tool}:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);

    findings.push({ stepIndex: step.index, tool, url: step.snapshot?.url, text });
  }

  return findings;
}

/** Narrow the findings to what fits `charBudget`, keeping the most recent. */
export function buildLedger(findings: Finding[], charBudget: number): FindingsLedger {
  const candidates = findings.slice(-MAX_FINDINGS);
  const kept: Finding[] = [];
  let used = 0;

  for (let i = candidates.length - 1; i >= 0; i--) {
    const cost = renderFinding(candidates[i]).length + 1;
    if (used + cost > charBudget && kept.length > 0) break;
    kept.unshift(candidates[i]);
    used += cost;
  }

  return { findings: kept, omitted: findings.length - kept.length };
}

function renderFinding(finding: Finding): string {
  const where = finding.url ? ` @ ${finding.url}` : '';
  return `- #${finding.stepIndex + 1} ${finding.tool}${where}: ${finding.text}`;
}

/**
 * The block handed to the model. Null when there is nothing to carry, so a short task pays
 * nothing for this.
 *
 * When findings had to be dropped the notice is deliberately directive rather than apologetic:
 * losing the oldest entries means the sweep is outgrowing the context, and the useful response
 * to that is to land the answer, not to keep collecting into a bucket with a hole in it.
 */
export function renderFindingsBlock(findings: Finding[], charBudget: number): string | null {
  if (findings.length === 0 || charBudget <= 0) return null;

  const ledger = buildLedger(findings, charBudget);
  if (ledger.findings.length === 0) return null;

  const header = `[COLLECTED SO FAR — ${findings.length} finding(s) from this run, replayed here because the conversation itself no longer holds them]`;
  const lines = ledger.findings.map(renderFinding);
  const footer = ledger.omitted > 0
    ? `(${ledger.omitted} older finding(s) no longer fit and are not shown. You are collecting faster than you can carry: stop widening the sweep, and call done with what is listed, naming what you could not cover.)`
    : 'Treat this as already collected. Do not re-visit or re-extract any of it; spend the remaining steps only on what is still missing.';

  return [header, ...lines, footer].join('\n');
}
