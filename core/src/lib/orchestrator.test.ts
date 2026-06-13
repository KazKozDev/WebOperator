import { describe, expect, it } from 'vitest';
import { buildOrchestrationPlanFromPlan, mirrorPlanProgress, startSubtask } from './orchestrator';
import type { AgentPlan, PlanStep } from './types';

function plan(statuses: PlanStep['status'][]): AgentPlan {
  return {
    goal: 'rank products',
    steps: statuses.map((status, i) => ({
      index: i + 1,
      description: `Step ${i + 1}: collect data from page ${i + 1}`,
      status,
    })),
    currentStep: Math.max(0, statuses.findIndex((s) => s === 'active')),
    createdAt: Date.now(),
  };
}

describe('orchestrator plan derivation', () => {
  it('derives one subtask per plan step, 1:1 by index', () => {
    const orch = buildOrchestrationPlanFromPlan('t1', plan(['active', 'pending', 'pending']));

    expect(orch.subtasks).toHaveLength(3);
    expect(orch.subtasks.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(orch.subtasks.every((s) => s.status === 'pending')).toBe(true);
    expect(orch.goal).toBe('rank products');
  });

  it('mirrors completed plan steps into subtasks', () => {
    const p = plan(['done', 'done', 'active']);
    const orch = buildOrchestrationPlanFromPlan('t1', p);

    mirrorPlanProgress(p, orch);

    expect(orch.subtasks[0].status).toBe('done');
    expect(orch.subtasks[1].status).toBe('done');
    expect(orch.subtasks[2].status).toBe('running');
  });

  it('marks the orchestration plan done when all steps complete', () => {
    const p = plan(['done', 'done', 'done']);
    const orch = buildOrchestrationPlanFromPlan('t1', p);

    mirrorPlanProgress(p, orch);

    expect(orch.subtasks.every((s) => s.status === 'done')).toBe(true);
    expect(orch.status).toBe('done');
  });

  it('does not override explicitly managed subtasks', () => {
    const p = plan(['done', 'active', 'pending']);
    const orch = buildOrchestrationPlanFromPlan('t1', p);
    // Model explicitly works on subtask 3 out of plan order
    startSubtask(orch, '3');

    mirrorPlanProgress(p, orch);

    expect(orch.subtasks[0].status).toBe('done');
    // Explicit running subtask stays running; mirror does not start subtask 2
    expect(orch.subtasks[2].status).toBe('running');
    expect(orch.subtasks[1].status).toBe('pending');
  });
});
