/**
 * Session Memory & Conversational Continuity Engine for WebOperator.
 * Tracks multi-turn dialogue, previous goals, extracted data, visited URLs,
 * and findings within the active browsing session so the agent remembers
 * conversational context across consecutive prompts.
 */

import { listTasks, loadSteps } from './storage';

export interface SessionTurnSummary {
  taskId: string;
  goal: string;
  answer: string | null;
  status: 'done' | 'failed';
  lastUrl?: string;
  extractedSnippet?: string;
  timestamp: number;
}

export async function getRecentSessionContext(
  tabId: number,
  currentUrl?: string,
  maxTurns: number = 3
): Promise<string> {
  try {
    const recentTasks = await listTasks(15);
    // Find tasks from the same tab or recent session within 2 hours
    const now = Date.now();
    const sessionTasks = recentTasks
      .filter((t) => (t.tabId === tabId || now - t.createdAt < 2 * 60 * 60 * 1000) && (t.status === 'done' || t.status === 'failed'))
      .slice(0, maxTurns)
      .reverse();

    if (sessionTasks.length === 0) return '';

    const turns: string[] = [];

    for (const [idx, t] of sessionTasks.entries()) {
      const steps = await loadSteps(t.id).catch(() => []);
      
      // Extract final answer or last done summary
      let finalSummary = '';
      const doneStep = steps.find((s) => s.toolCall?.name === 'done');
      if (doneStep?.toolCall?.arguments?.summary) {
        finalSummary = String(doneStep.toolCall.arguments.summary);
      } else if (t.error) {
        finalSummary = `Failed: ${t.error}`;
      }

      // Collect any extracted data snippet
      const extractSteps = steps.filter((s) => s.toolCall?.name === 'extract' && s.result?.extracted);
      const extractedData = extractSteps
        .map((s) => typeof s.result?.extracted === 'string' ? s.result.extracted : JSON.stringify(s.result?.extracted))
        .join('; ')
        .slice(0, 300);

      // Find last navigated URL
      const lastNav = steps.slice().reverse().find((s) => s.toolCall?.name === 'navigate')?.toolCall?.arguments?.url;
      const urlInfo = lastNav ? String(lastNav) : (currentUrl || '');

      let turnText = `Turn ${idx + 1}:
  User Request: "${t.goal}"
  Status: ${t.status}`;

      if (finalSummary) {
        turnText += `\n  Agent Findings / Answer: ${finalSummary.slice(0, 400)}`;
      }
      if (extractedData) {
        turnText += `\n  Extracted Data: ${extractedData}`;
      }
      if (urlInfo) {
        turnText += `\n  Visited URL: ${urlInfo}`;
      }

      turns.push(turnText);
    }

    if (turns.length === 0) return '';

    return `[PREVIOUS SESSION CONVERSATION & FINDINGS]
The user is continuing a multi-turn browsing session. Use this memory to understand pronouns and references ("it", "the second one", "that page", "previous results", "найденные данные", "первый товар", "тот же сайт"):

${turns.join('\n\n')}

Current URL: ${currentUrl || 'active tab'}
Ensure continuity: do not restart from scratch if the user asks a follow-up question regarding previous findings.`;
  } catch (err) {
    console.warn('[session-memory] Failed to load session context', err);
    return '';
  }
}
