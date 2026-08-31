import type {
  Checkpoint,
  DecompositionResult,
  OrchestrationPlan,
  OrchestratorEvent,
  Subtask,
  TabContext,
} from './orchestrator-types';
import type { AgentPlan, SkillId } from './types';
import { classifyTask, getSkill } from './skills';

// ── Tab Manager ───────────────────────────────────────────────────────

export class TabManager {
  private tabs = new Map<number, TabContext>();
  private listeners: Array<(event: OrchestratorEvent) => void> = [];

  onEvent(fn: (event: OrchestratorEvent) => void): void {
    this.listeners.push(fn);
  }

  private emit(event: OrchestratorEvent): void {
    for (const fn of this.listeners) fn(event);
  }

  async openWorkerTab(
    taskId: string,
    subtaskId: string,
    url: string,
    active: boolean = false,
  ): Promise<number> {
    const tab = await chrome.tabs.create({ url, active });
    const ctx: TabContext = {
      tabId: tab.id!,
      url,
      title: '',
      role: 'worker',
      assignedSubtaskId: subtaskId,
      openedAt: Date.now(),
    };
    this.tabs.set(tab.id!, ctx);

    await this.waitForLoad(tab.id!);

    const updated = await chrome.tabs.get(tab.id!);
    ctx.url = updated.url ?? url;
    ctx.title = updated.title ?? '';

    this.emit({
      kind: 'orchestrator:tab:opened',
      taskId,
      subtaskId,
      tabId: tab.id!,
      url: ctx.url,
    });

    return tab.id!;
  }

  setPrimaryTab(tabId: number, url: string, title: string): void {
    const existing = this.tabs.get(tabId);
    if (existing) {
      existing.role = 'primary';
      existing.url = url;
      existing.title = title;
    } else {
      this.tabs.set(tabId, {
        tabId,
        url,
        title,
        role: 'primary',
        openedAt: Date.now(),
      });
    }
  }

  async switchToTab(tabId: number, active: boolean = true): Promise<void> {
    const ctx = this.tabs.get(tabId);
    if (!ctx) throw new Error(`No context for tab ${tabId}`);
    if (active) {
      await chrome.tabs.update(tabId, { active: true });
    }
    await this.waitForLoad(tabId);
  }

  async closeTab(taskId: string, subtaskId: string, tabId: number): Promise<void> {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      /* tab may already be closed */
    }
    this.tabs.delete(tabId);
    this.emit({
      kind: 'orchestrator:tab:closed',
      taskId,
      subtaskId,
      tabId,
    });
  }

  getTabContext(tabId: number): TabContext | undefined {
    return this.tabs.get(tabId);
  }

  getWorkerTabs(): TabContext[] {
    return [...this.tabs.values()].filter((t) => t.role === 'worker');
  }

  getPrimaryTab(): TabContext | undefined {
    return [...this.tabs.values()].find((t) => t.role === 'primary');
  }

  workerCount(): number {
    return this.getWorkerTabs().length;
  }

  clear(): void {
    this.tabs.clear();
  }

  private async waitForLoad(tabId: number, timeoutMs = 15_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') return;
      } catch {
        return;
      }
      await sleep(150);
    }
  }
}

// ── Checkpoint Manager ─────────────────────────────────────────────────

export class CheckpointManager {
  private readonly prefix = 'orch_ckpt_';

  async save(
    taskId: string,
    plan: OrchestrationPlan,
    tabContexts: TabContext[],
  ): Promise<void> {
    const checkpoint: Checkpoint = {
      taskId,
      plan: { ...plan, updatedAt: Date.now() },
      tabContexts: [...tabContexts],
      savedAt: Date.now(),
      version: 1,
    };
    await chrome.storage.local.set({ [this.prefix + taskId]: checkpoint });
  }

  async load(taskId: string): Promise<Checkpoint | null> {
    const raw = await chrome.storage.local.get(this.prefix + taskId);
    const data = raw[this.prefix + taskId];
    if (data && data.version === 1 && data.plan) {
      return data as Checkpoint;
    }
    return null;
  }

  async remove(taskId: string): Promise<void> {
    await chrome.storage.local.remove(this.prefix + taskId);
  }

  async pruneOlderThan(maxAgeMs: number): Promise<void> {
    const all = await chrome.storage.local.get(null);
    const cutoff = Date.now() - maxAgeMs;
    const toRemove: string[] = [];
    for (const [key, val] of Object.entries(all)) {
      if (!key.startsWith(this.prefix)) continue;
      try {
        const c = val as Checkpoint;
        if (c.savedAt < cutoff) toRemove.push(key);
      } catch {
        /* skip malformed */
      }
    }
    if (toRemove.length > 0) {
      await chrome.storage.local.remove(toRemove);
    }
  }
}

// ── Task Decomposer ────────────────────────────────────────────────────

// The orchestration plan is derived from the accepted set_task_plan tool call,
// never parsed out of free-form model reasoning: plan steps and subtasks are
// 1:1 by index, so there is a single source of truth for task structure.
export function buildOrchestrationPlanFromPlan(taskId: string, plan: AgentPlan): OrchestrationPlan {
  const decomposition: DecompositionResult = {
    subtasks: plan.steps.map((step) => {
      const classified = classifyTask(step.description);
      return {
        index: step.index,
        description: step.description,
        skillId: classified.length > 0 ? classified[0].id : undefined,
        dependsOn: [],
      };
    }),
    reasoning: plan.intent ?? '',
  };
  return buildOrchestrationPlan(taskId, plan.goal, decomposition);
}

// Mirror plan-step progress into the derived subtasks. Only moves subtasks
// forward (pending/running -> done); explicit finish_subtask/fail_subtask
// calls from the model are never overridden.
export function mirrorPlanProgress(plan: AgentPlan, orch: OrchestrationPlan): void {
  for (const step of plan.steps) {
    if (step.status !== 'done') continue;
    const st = orch.subtasks.find((s) => s.index === step.index);
    if (st && (st.status === 'pending' || st.status === 'running')) {
      st.status = 'done';
      st.finishedAt = Date.now();
    }
  }

  const hasRunning = orch.subtasks.some((s) => s.status === 'running');
  if (!hasRunning) {
    const active = plan.steps.find((s) => s.status === 'active');
    const st = active ? orch.subtasks.find((s) => s.index === active.index) : undefined;
    if (st && st.status === 'pending') st.status = 'running';
  }

  if (allSubtasksComplete(orch)) orch.status = 'done';
  orch.updatedAt = Date.now();
}

export function buildOrchestrationPlan(
  taskId: string,
  goal: string,
  decomposition: DecompositionResult,
): OrchestrationPlan {
  const subtaskEntries: Subtask[] = decomposition.subtasks.map((st) => ({
    id: `${taskId}-sub-${st.index}`,
    index: st.index,
    description: st.description,
    status: 'pending' as const,
    skillId: st.skillId as SkillId | undefined,
    dependsOn: st.dependsOn,
    steps: [],
    createdAt: Date.now(),
    url: st.url,
  }));

  return {
    id: taskId,
    goal,
    subtasks: subtaskEntries,
    activeSubtasks: [],
    status: 'planning',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    managed: false,
  };
}

// ── Plan Progress ─────────────────────────────────────────────────────

// One-line progress, for prompts that already carry the [PLAN] block. Subtasks mirror
// the plan steps 1:1, so listing them there would send the same step list twice.
export function planProgressLine(plan: OrchestrationPlan): string {
  const total = plan.subtasks.length;
  const done = plan.subtasks.filter((s) => s.status === 'done').length;
  const failed = plan.subtasks.filter((s) => s.status === 'failed').length;
  const running = plan.subtasks.find((s) => s.status === 'running');
  const parts = [`[ORCHESTRATOR] ${done}/${total} sub-tasks done${failed > 0 ? `, ${failed} failed` : ''}`];
  if (running) parts.push(`running #${running.index}`);
  return parts.join(' · ');
}

export function planSummary(plan: OrchestrationPlan): string {
  const total = plan.subtasks.length;
  const done = plan.subtasks.filter((s) => s.status === 'done').length;
  const failed = plan.subtasks.filter((s) => s.status === 'failed').length;
  const running = plan.subtasks.filter((s) => s.status === 'running').length;
  const pending = plan.subtasks.filter((s) => s.status === 'pending').length;

  const lines: string[] = [
    `[ORCHESTRATOR] Progress: ${done}/${total} done, ${running} running, ${pending} pending${failed > 0 ? `, ${failed} failed` : ''}`,
  ];

  for (const st of plan.subtasks) {
    const icon =
      st.status === 'done' ? '✓' :
      st.status === 'running' ? '▶' :
      st.status === 'failed' ? '✗' :
      st.status === 'skipped' ? '⏭' : '○';

    const skillTag = st.skillId ? ` [${st.skillId}]` : '';
    lines.push(`  ${icon} ${st.index}. ${st.description}${skillTag}`);
  }

  return lines.join('\n');
}

export function allSubtasksComplete(plan: OrchestrationPlan): boolean {
  return plan.subtasks.every(
    (s) => s.status === 'done' || s.status === 'skipped' || s.status === 'failed',
  );
}

export function anySubtasksPending(plan: OrchestrationPlan): boolean {
  return plan.subtasks.some((s) => s.status === 'pending');
}

export function nextPendingSubtask(plan: OrchestrationPlan): Subtask | undefined {
  return plan.subtasks.find((s) => s.status === 'pending');
}

export function findSubtask(plan: OrchestrationPlan, subtaskIdOrIndex: string): Subtask | undefined {
  const raw = subtaskIdOrIndex.trim();
  const asIndex = Number(raw);
  return plan.subtasks.find((s) => s.id === raw || (!Number.isNaN(asIndex) && s.index === asIndex));
}

export function startSubtask(plan: OrchestrationPlan, subtaskIdOrIndex: string): Subtask | undefined {
  const st = findSubtask(plan, subtaskIdOrIndex);
  if (!st) return undefined;
  for (const other of plan.subtasks) {
    if (other.status === 'running' && other.id !== st.id) {
      other.status = 'pending';
    }
  }
  st.status = 'running';
  plan.status = 'running';
  plan.updatedAt = Date.now();
  return st;
}

export function advanceOrchPlan(plan: OrchestrationPlan, toolName: string): void {
  if (
    toolName === 'done' ||
    toolName === 'start_subtask' ||
    toolName === 'finish_subtask' ||
    toolName === 'fail_subtask' ||
    toolName === 'update_task_memory'
  ) return;

  const activeSubtask = plan.subtasks.find((s) => s.status === 'running');
  if (!activeSubtask) {
    const pending = nextPendingSubtask(plan);
    if (pending) {
      pending.status = 'running';
    }
    return;
  }

  // Heuristic: extract means the current sub-task is collecting data
  // It's not yet complete until the model explicitly calls done for this sub-task
  // or moves to the next step. We keep the sub-task running.
  activeSubtask.steps.push({
    id: `${plan.id}-step-${activeSubtask.steps.length}`,
    index: activeSubtask.steps.length,
    status: 'ok',
    startedAt: Date.now(),
    finishedAt: Date.now(),
    note: `Action: ${toolName}`,
    timings: { totalMs: 0 },
  });

  plan.updatedAt = Date.now();
}

export function getCurrentSubtask(plan: OrchestrationPlan): Subtask | undefined {
  return plan.subtasks.find((s) => s.status === 'running');
}

export function markSubtaskDone(plan: OrchestrationPlan, subtaskId: string): void {
  const st = findSubtask(plan, subtaskId);
  if (st) {
    st.status = 'done';
    st.finishedAt = Date.now();
    plan.updatedAt = Date.now();
  }
}

export function markSubtaskFailed(plan: OrchestrationPlan, subtaskId: string, error: string): void {
  const st = findSubtask(plan, subtaskId);
  if (st) {
    st.status = 'failed';
    st.error = error;
    st.finishedAt = Date.now();
    plan.updatedAt = Date.now();
  }
}

export function getSubtaskResult(plan: OrchestrationPlan, index: number): string | undefined {
  const st = plan.subtasks.find((s) => s.index === index);
  return st?.result;
}

// ── Sub-task skill injection ──────────────────────────────────────────

export function skillPromptForSubtask(subtask: Subtask): string {
  const prompts: string[] = [];

  // Get the skill's own prompt
  if (subtask.skillId) {
    const skill = getSkill(subtask.skillId);
    if (skill) {
      prompts.push(skill.prompt);
    }
  }

  // Inject context from completed dependent subtasks
  prompts.push(`SUBTASK: ${subtask.description}`);

  return prompts.join('\n\n');
}

// ── Utils ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
