import type { AgentStep } from './types';

export interface Subtask {
  id: string;
  index: number;
  description: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  skillId?: string;
  tabId?: number;
  url?: string;
  steps: AgentStep[];
  result?: string;
  error?: string;
  dependsOn: number[];
  createdAt: number;
  finishedAt?: number;
}

export interface OrchestrationPlan {
  id: string;
  goal: string;
  subtasks: Subtask[];
  activeSubtasks: number[];
  status: 'planning' | 'running' | 'paused' | 'done' | 'failed';
  createdAt: number;
  updatedAt: number;
  // True once the model explicitly drives subtasks (start/finish/fail_subtask).
  // Until then subtasks are a passive 1:1 mirror of the plan steps and carry no
  // information the plan view does not already show.
  managed: boolean;
}

export interface Checkpoint {
  taskId: string;
  plan: OrchestrationPlan;
  tabContexts: TabContext[];
  savedAt: number;
  version: number;
}

export interface TabContext {
  tabId: number;
  url: string;
  title: string;
  role: 'primary' | 'worker';
  assignedSubtaskId?: string;
  lastSnapshotHash?: string;
  openedAt: number;
}

export interface DecompositionResult {
  subtasks: {
    index: number;
    description: string;
    skillId?: string;
    url?: string;
    dependsOn: number[];
  }[];
  reasoning: string;
}

export type OrchestratorEvent =
  | { kind: 'orchestrator:plan:created'; taskId: string; plan: OrchestrationPlan }
  | { kind: 'orchestrator:subtask:started'; taskId: string; subtaskId: string; tabId: number }
  | { kind: 'orchestrator:subtask:done'; taskId: string; subtaskId: string; result: string }
  | { kind: 'orchestrator:subtask:failed'; taskId: string; subtaskId: string; error: string }
  | { kind: 'orchestrator:tab:opened'; taskId: string; subtaskId: string; tabId: number; url: string }
  | { kind: 'orchestrator:tab:closed'; taskId: string; subtaskId: string; tabId: number }
  | { kind: 'orchestrator:done'; taskId: string; success: boolean; summary: string }
  | { kind: 'orchestrator:checkpoint:saved'; taskId: string; subtaskId: string }
  | { kind: 'orchestrator:checkpoint:restored'; taskId: string };
