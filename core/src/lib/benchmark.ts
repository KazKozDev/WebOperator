import type { AgentStep, ModelProfile, StepTimings } from './types';
import { LATENCY_TARGETS_MS, PROFILE_LATENCY_MULT } from './types';

export interface LatencyTarget {
  label: string;
  budgetMs: number;
  exceeds: boolean;
}

export function latencyTarget(step: AgentStep, profile: ModelProfile): LatencyTarget {
  const mult = PROFILE_LATENCY_MULT[profile] ?? 1;
  let label: string;
  let base: number;
  if (step.cached) { label = 'cache hit'; base = LATENCY_TARGETS_MS.cacheHit; }
  else if (step.index === 0) { label = 'planning'; base = LATENCY_TARGETS_MS.planning; }
  else if (step.thought) { label = 'step+think'; base = LATENCY_TARGETS_MS.stepWithThink; }
  else if (step.usedVision) { label = 'step+vision'; base = LATENCY_TARGETS_MS.stepWithVisionNoThink; }
  else { label = 'step (fast)'; base = LATENCY_TARGETS_MS.stepNoVisionNoThink; }
  const budgetMs = Math.round(base * mult);
  const total = step.timings?.totalMs ?? 0;
  return { label, budgetMs, exceeds: total > budgetMs };
}

export interface ProfileSummary {
  profile: ModelProfile;
  steps: number;
  p50: number;
  p95: number;
  exceedRate: number;
}

export function summarize(steps: AgentStep[], profile: ModelProfile): ProfileSummary {
  const totals: number[] = steps
    .map((s) => s.timings?.totalMs)
    .filter((x): x is number => typeof x === 'number')
    .sort((a, b) => a - b);
  if (totals.length === 0) return { profile, steps: 0, p50: 0, p95: 0, exceedRate: 0 };
  const p50 = totals[Math.floor(totals.length * 0.5)];
  const p95 = totals[Math.min(totals.length - 1, Math.floor(totals.length * 0.95))];
  const exceed = steps.reduce((n, s) => n + (latencyTarget(s, profile).exceeds ? 1 : 0), 0);
  return {
    profile,
    steps: steps.length,
    p50: Math.round(p50),
    p95: Math.round(p95),
    exceedRate: exceed / steps.length,
  };
}

export function formatTimings(t?: StepTimings): string {
  if (!t) return '';
  const parts: string[] = [`total ${Math.round(t.totalMs)}ms`];
  if (t.snapshotMs) parts.push(`snap ${Math.round(t.snapshotMs)}`);
  if (t.screenshotMs) parts.push(`shot ${Math.round(t.screenshotMs)}`);
  if (t.llmMs) parts.push(`llm ${Math.round(t.llmMs)}`);
  if (t.actionMs) parts.push(`act ${Math.round(t.actionMs)}`);
  return parts.join(' · ');
}
