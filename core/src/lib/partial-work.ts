import type { AgentPlan, AgentStep, AgentTask } from './types';

/**
 * Everything a task managed to collect before it was interrupted.
 *
 * An interrupted run is not a failed run: the evidence it gathered is often
 * most of the answer. These helpers turn a trace into something the user can
 * read and question, without going back to the browser.
 */

/** One piece of evidence the agent extracted, in the order it was collected. */
export interface EvidenceItem {
  stepIndex: number;
  tool: string;
  url?: string;
  /** What the action returned, trimmed for prompting. */
  text: string;
}

export interface CollectedWork {
  evidence: EvidenceItem[];
  visitedUrls: string[];
  completedPlanSteps: string[];
  remainingPlanSteps: string[];
  stepsRun: number;
  failedSteps: number;
}

const MAX_EVIDENCE_ITEMS = 40;
const MAX_ITEM_CHARS = 1200;

/** Tools whose results are observations rather than side effects. */
const EVIDENCE_TOOLS = new Set([
  'extract', 'read_cells', 'list_tabs', 'finish_subtask', 'update_task_memory', 'done',
]);

function stringifyExtracted(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function trim(text: string, limit = MAX_ITEM_CHARS): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit)}…` : collapsed;
}

function planSteps(plan: AgentPlan | undefined): { done: string[]; left: string[] } {
  const done: string[] = [];
  const left: string[] = [];
  for (const step of plan?.steps ?? []) {
    (step.status === 'done' ? done : left).push(step.description);
  }
  return { done, left };
}

/**
 * Pull the usable results out of a trace. Steps that only moved the browser
 * around carry no information on their own, so only their URLs are kept.
 */
export function collectWork(task: Pick<AgentTask, 'steps' | 'plan'>): CollectedWork {
  const evidence: EvidenceItem[] = [];
  const visited: string[] = [];
  let failedSteps = 0;

  for (const step of task.steps) {
    const url = step.snapshot?.url;
    if (url && !visited.includes(url)) visited.push(url);
    if (step.status === 'fail' || step.result?.error) failedSteps += 1;

    const tool = step.toolCall?.name;
    if (!tool || !EVIDENCE_TOOLS.has(tool)) continue;

    const text = trim(stringifyExtracted(step.result?.extracted));
    if (!text) continue;
    evidence.push({ stepIndex: step.index, tool, url, text });
  }

  const { done, left } = planSteps(task.plan);
  return {
    // Keep the most recent evidence when a long run overflows the budget: it
    // is closest to where the agent stopped, and so to what the user is asking
    // about.
    evidence: evidence.slice(-MAX_EVIDENCE_ITEMS),
    visitedUrls: visited,
    completedPlanSteps: done,
    remainingPlanSteps: left,
    stepsRun: task.steps.length,
    failedSteps,
  };
}

function renderEvidence(work: CollectedWork): string {
  if (work.evidence.length === 0) return '(no data was extracted before the interruption)';
  return work.evidence
    .map((item) => `- [step ${item.stepIndex}] ${item.tool}${item.url ? ` @ ${item.url}` : ''}: ${item.text}`)
    .join('\n');
}

/**
 * Asks the model to summarize an interrupted run. The instruction leans hard
 * on not finishing the job: a partial summary that reads like a complete
 * answer is worse than no summary, because the user cannot tell what is
 * missing.
 */
export function buildPartialSummaryPrompt(goal: string, work: CollectedWork): string {
  const remaining = work.remainingPlanSteps.length > 0
    ? work.remainingPlanSteps.map((step) => `- ${step}`).join('\n')
    : '- (no plan steps were left outstanding)';

  return [
    'A browser task was interrupted by the user before it finished.',
    'Summarize what was actually collected. Do not continue the task, do not',
    'guess at the missing parts, and do not present this as a complete answer.',
    '',
    `Goal: ${goal}`,
    '',
    'Collected so far:',
    renderEvidence(work),
    '',
    'Plan steps not completed:',
    remaining,
    '',
    'Write two short sections:',
    '1. "Collected" — the findings, with the concrete values that were seen.',
    '2. "Not covered" — what the goal asked for that the evidence does not answer.',
    'If nothing usable was collected, say so plainly in one sentence.',
  ].join('\n');
}

/**
 * A summary built without the model, for when it is unreachable or errors.
 * Interrupting a task must never depend on a working provider — that is often
 * exactly why the user is interrupting.
 */
export function fallbackPartialSummary(goal: string, work: CollectedWork): string {
  const lines: string[] = [`Stopped before finishing: ${goal}`, ''];

  if (work.evidence.length === 0) {
    lines.push(`Collected: nothing was extracted in ${work.stepsRun} step(s) before the stop.`);
  } else {
    lines.push('Collected:');
    for (const item of work.evidence.slice(-10)) {
      lines.push(`- ${trim(item.text, 300)}${item.url ? ` (${item.url})` : ''}`);
    }
  }

  if (work.remainingPlanSteps.length > 0) {
    lines.push('', 'Not covered:');
    for (const step of work.remainingPlanSteps) lines.push(`- ${step}`);
  }

  lines.push('', `${work.stepsRun} step(s) ran, ${work.failedSteps} failed. Resume to continue from here.`);
  return lines.join('\n');
}

/**
 * Question answering over a finished or interrupted run. The point is to reuse
 * what was already gathered instead of re-walking the pages, so the model is
 * given the trace and told to stay inside it.
 */
export function buildTraceQuestionPrompt(goal: string, work: CollectedWork, question: string): string {
  return [
    'Answer a question about a browser task using only the evidence below.',
    'The evidence is everything the agent collected; it may be incomplete',
    'because the run was interrupted.',
    '',
    `Original goal: ${goal}`,
    `Pages visited: ${work.visitedUrls.length > 0 ? work.visitedUrls.join(', ') : '(none recorded)'}`,
    '',
    'Evidence:',
    renderEvidence(work),
    '',
    `Question: ${question}`,
    '',
    'Answer from the evidence alone. If it does not contain what was asked,',
    'say which part is missing and what the agent would have to visit to get',
    'it. Never fill a gap with general knowledge.',
  ].join('\n');
}

/** Steps whose results were summarized, for marking the synthetic step. */
export function isInterrupted(status: AgentTask['status']): boolean {
  return status === 'stopped';
}

export type { AgentStep };

/** Evidence below this is too thin for the question to be worth asking. */
const SUFFICIENCY_MIN_EVIDENCE = 2;

/**
 * Asks the one question the loop never asks: is what you already have enough?
 *
 * Nothing in the run ever checks. On the AssistantBench task that took 82 steps, a single
 * `extract` at step 5 had already returned 27 of the 36 rows needed — including four of the five
 * gold answers — and the other 77 steps were spent not noticing. Every guard added so far is a
 * prohibition ("stop re-reading", "stop scrolling"); this is the one positive prompt, and it
 * deliberately does not repeat the evidence itself, which is already in the history. Re-listing
 * it would cost tokens to say what the model can already see; what is missing is the question.
 */
export function describeSufficiencyCheck(work: CollectedWork): string | null {
  if (work.evidence.length < SUFFICIENCY_MIN_EVIDENCE) return null;

  const steps = work.evidence.slice(-4).map((item) => `#${item.stepIndex}`).join(', ');
  const pages = work.visitedUrls.length;
  return `[SUFFICIENCY] You have ${work.evidence.length} finding(s) from ${pages} page(s) (most recent: ${steps}). Before choosing the next action, answer this to yourself: does what you already collected answer the goal? If it does, call done now. If it does not, name the one specific fact still missing and go get exactly that — do not re-read what you have or look for confirmation of it.`;
}
