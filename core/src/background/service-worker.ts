import { runTask } from './agent-loop';
import {
  clearCredentials,
  deleteCredential,
  deleteScheduledTask,
  getScheduledTask,
  getSettings,
  listCredentials,
  listScheduledTasks,
  saveCredential,
  saveScheduledTask,
  saveSettings,
  saveTask,
  listTasks,
  getTask,
  loadSteps,
  updateScheduledTask,
  db,
} from '@/lib/storage';
import { clearCache } from '@/lib/action-cache';
import { ensureContentScript } from '@/lib/messaging';
import type { AgentTask, ScheduledTask, SWMessage, ToolCall } from '@/lib/types';

type Pending = { allow: boolean | null; resolve: (v: boolean) => void };

const state = {
  stopped: new Set<string>(),
  paused: new Set<string>(),
  pendingConfirms: new Map<string, Pending>(),
  runningSchedules: new Set<string>(),
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
  reconcileScheduledAlarms().catch((err) => console.error('[schedule] reconcile failed', err));
});

chrome.runtime.onStartup?.addListener(() => {
  reconcileScheduledAlarms().catch((err) => console.error('[schedule] startup reconcile failed', err));
});

chrome.action?.onClicked.addListener(async (tab) => {
  if (tab.id !== undefined) await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  const msg = raw as SWMessage;
  handle(msg).then(sendResponse).catch((err) => {
    sendResponse({ error: err instanceof Error ? err.message : String(err) });
  });
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(SCHEDULE_ALARM_PREFIX)) return;
  const id = alarm.name.slice(SCHEDULE_ALARM_PREFIX.length);
  void runScheduledTask(id);
});

async function handle(msg: SWMessage): Promise<unknown> {
  switch (msg.kind) {
    case 'settings:get': return getSettings();
    case 'settings:update': return saveSettings(msg.patch);
    case 'task:list': return listTasks();
    case 'task:get': {
      const task = await getTask(msg.id);
      if (!task) return null;
      task.steps = await loadSteps(msg.id);
      return task;
    }
    case 'eval:startTask': return startEvalTask(msg);
    case 'eval:getTask': return getEvalTask(msg.id);
    case 'eval:waitTask': return waitForEvalTask(msg.id, msg.timeoutMs);
    case 'eval:clear': return clearEvalTasks();
    case 'task:start': return startTask(msg.goal, msg.tabId);
    case 'task:pause': state.paused.add(msg.id); return { ok: true };
    case 'task:resume': state.paused.delete(msg.id); return { ok: true };
    case 'task:stop': {
      state.stopped.add(msg.id);
      state.pendingConfirms.get(msg.id)?.resolve(false);
      return { ok: true };
    }
    case 'task:confirm': {
      state.pendingConfirms.get(msg.id)?.resolve(msg.allow);
      return { ok: true };
    }
    case 'cache:clear': {
      const removed = await clearCache();
      return { ok: true, removed };
    }
    case 'cache:stats': {
      const count = await db.actionCache.count();
      const now = Date.now();
      const live = await db.actionCache.where('expiresAt').above(now).count();
      return { count, live, expired: count - live };
    }
    case 'credential:list': return listCredentials();
    case 'credential:set': return saveCredential(msg.entry);
    case 'credential:delete': return deleteCredential(msg.id);
    case 'credential:clear': await clearCredentials(); return { ok: true };
    case 'schedule:list': {
      await reconcileScheduledAlarms();
      return listScheduledTasks();
    }
    case 'schedule:set': {
      const list = await saveScheduledTask(msg.entry);
      await reconcileScheduledAlarms();
      return list;
    }
    case 'schedule:delete': {
      await clearScheduleAlarm(msg.id);
      return deleteScheduledTask(msg.id);
    }
    case 'schedule:toggle': {
      const updated = await updateScheduledTask(msg.id, { enabled: msg.enabled, lastStatus: msg.enabled ? 'enabled' : 'paused' });
      if (!updated) return null;
      await reconcileScheduledAlarms();
      return listScheduledTasks();
    }
    case 'schedule:run': {
      void runScheduledTask(msg.id, true);
      return listScheduledTasks();
    }
    default:
      throw new Error('Unknown message');
  }
}

async function startTask(goal: string, tabId: number, options: { autoConfirm?: boolean } = {}): Promise<AgentTask> {
  const settings = await getSettings();
  const task = createAgentTask(goal, tabId, settings);
  await saveTask(task);
  await ensureContentScript(tabId);

  runTask(task, {
    settings,
    shouldConfirm: (t: AgentTask, _call: ToolCall) => options.autoConfirm
      ? Promise.resolve(true)
      : new Promise<boolean>((resolve) => {
        state.pendingConfirms.set(t.id, { allow: null, resolve });
      }).finally(() => { state.pendingConfirms.delete(task.id); }),
    isStopped: (id) => state.stopped.has(id),
    isPaused: (id) => state.paused.has(id),
    requestPause: (id) => state.paused.add(id),
    requestResume: (id) => state.paused.delete(id),
  }).catch((err) => console.error('[agent] run failed', err));

  return task;
}

const EVAL_TASK_IDS_KEY = 'evalTaskIds';

function assertEvalApiEnabled(): void {
  if (import.meta.env.MODE === 'production') {
    throw new Error('Eval API is disabled in production builds. Build with vite --mode development.');
  }
}

async function startEvalTask(msg: Extract<SWMessage, { kind: 'eval:startTask' }>): Promise<AgentTask> {
  assertEvalApiEnabled();

  if (msg.settingsPatch && Object.keys(msg.settingsPatch).length > 0) {
    await saveSettings(msg.settingsPatch);
  }

  let tabId = msg.tabId;
  if (!tabId) {
    if (!msg.startUrl) throw new Error('eval:startTask requires startUrl or tabId');
    const tab = await chrome.tabs.create({ url: msg.startUrl, active: true });
    if (!tab.id) throw new Error('Chrome did not return a tabId for eval task');
    tabId = tab.id;
    await waitForTabComplete(tabId);
  }

  const task = await startTask(msg.goal, tabId, { autoConfirm: true });
  await rememberEvalTaskId(task.id);
  return getEvalTask(task.id) as Promise<AgentTask>;
}

async function getEvalTask(id: string): Promise<AgentTask | null> {
  assertEvalApiEnabled();
  const task = await getTask(id);
  if (!task) return null;
  task.steps = await loadSteps(id);
  return task;
}

async function waitForEvalTask(id: string, timeoutMs = 120_000): Promise<AgentTask | null> {
  assertEvalApiEnabled();
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const task = await getEvalTask(id);
    if (!task) return null;
    if (task.status === 'done' || task.status === 'failed' || task.status === 'paused' || task.status === 'awaiting_confirm') {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return getEvalTask(id);
}

async function clearEvalTasks(): Promise<{ ok: true; removed: number }> {
  assertEvalApiEnabled();
  const ids = await loadEvalTaskIds();
  for (const id of ids) {
    state.stopped.add(id);
    const task = await getTask(id);
    if (task?.tabId) {
      await chrome.tabs.remove(task.tabId).catch(() => {});
    }
    await db.steps.where('taskId').equals(id).delete();
    await db.tasks.delete(id);
  }
  await chrome.storage.local.remove(EVAL_TASK_IDS_KEY);
  return { ok: true, removed: ids.length };
}

async function rememberEvalTaskId(id: string): Promise<void> {
  const ids = await loadEvalTaskIds();
  await chrome.storage.local.set({ [EVAL_TASK_IDS_KEY]: Array.from(new Set([...ids, id])) });
}

async function loadEvalTaskIds(): Promise<string[]> {
  const raw = await chrome.storage.local.get(EVAL_TASK_IDS_KEY);
  const ids = raw[EVAL_TASK_IDS_KEY];
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

const SCHEDULE_ALARM_PREFIX = 'schedule:';

async function reconcileScheduledAlarms(): Promise<void> {
  const schedules = await listScheduledTasks();
  const enabledIds = new Set(schedules.filter((entry) => entry.enabled).map((entry) => entry.id));
  const alarms = await chrome.alarms.getAll();
  await Promise.all(
    alarms
      .filter((alarm) => alarm.name.startsWith(SCHEDULE_ALARM_PREFIX) && !enabledIds.has(alarm.name.slice(SCHEDULE_ALARM_PREFIX.length)))
      .map((alarm) => chrome.alarms.clear(alarm.name)),
  );

  for (const schedule of schedules) {
    if (!schedule.enabled) continue;
    if (schedule.nextRunAt <= Date.now()) {
      void runScheduledTask(schedule.id);
    } else {
      await scheduleAlarm(schedule);
    }
  }
}

async function scheduleAlarm(schedule: ScheduledTask): Promise<void> {
  await chrome.alarms.create(`${SCHEDULE_ALARM_PREFIX}${schedule.id}`, { when: schedule.nextRunAt });
}

async function clearScheduleAlarm(id: string): Promise<void> {
  await chrome.alarms.clear(`${SCHEDULE_ALARM_PREFIX}${id}`);
}

async function runScheduledTask(id: string, force = false): Promise<void> {
  if (state.runningSchedules.has(id)) return;
  const schedule = await getScheduledTask(id);
  if (!schedule) {
    await clearScheduleAlarm(id);
    return;
  }
  if (!force && (!schedule.enabled || schedule.nextRunAt > Date.now() + 1_000)) {
    await scheduleAlarm(schedule);
    return;
  }

  state.runningSchedules.add(id);
  await clearScheduleAlarm(id);
  await updateScheduledTask(id, { lastStatus: 'running', lastRunAt: Date.now(), lastError: undefined });

  let task: AgentTask | null = null;
  try {
    const settings = await getSettings();
    const tab = await chrome.tabs.create({ url: schedule.startUrl, active: false });
    if (!tab.id) throw new Error('Chrome did not return a tabId for scheduled task');
    await waitForTabComplete(tab.id);
    await ensureContentScript(tab.id);

    task = createAgentTask(schedule.goal, tab.id, settings);
    await saveTask(task);

    const finalTask = await runTask(task, {
      settings,
      shouldConfirm: async () => {
        await updateScheduledTask(id, {
          lastStatus: 'needs_user',
          lastTaskId: task?.id,
          lastError: 'Scheduled task needs user confirmation',
        });
        return false;
      },
      isStopped: (taskId) => state.stopped.has(taskId),
      isPaused: (taskId) => state.paused.has(taskId),
      requestPause: (taskId) => state.paused.add(taskId),
      requestResume: (taskId) => state.paused.delete(taskId),
    });

    const lastStatus = finalTask.status === 'done' ? 'last_success' : finalTask.status === 'awaiting_confirm' ? 'needs_user' : 'last_failed';
    await updateScheduleAfterRun(schedule, {
      lastTaskId: finalTask.id,
      lastStatus,
      lastError: lastStatus === 'last_failed' ? `Task ended with status ${finalTask.status}` : undefined,
    });
  } catch (err) {
    await updateScheduleAfterRun(schedule, {
      lastTaskId: task?.id,
      lastStatus: 'last_failed',
      lastError: err instanceof Error ? err.message : String(err),
    });
    console.error('[schedule] run failed', err);
  } finally {
    state.runningSchedules.delete(id);
  }
}

async function updateScheduleAfterRun(
  schedule: ScheduledTask,
  patch: Pick<ScheduledTask, 'lastStatus'> & Partial<Pick<ScheduledTask, 'lastTaskId' | 'lastError'>>,
): Promise<void> {
  const nextRunAt = nextScheduledRun(schedule.repeat, Date.now());
  const update: Partial<ScheduledTask> = {
    ...patch,
    lastRunAt: Date.now(),
    enabled: schedule.repeat === 'once' ? false : schedule.enabled,
    nextRunAt,
  };
  const updated = await updateScheduledTask(schedule.id, update);
  if (updated?.enabled) await scheduleAlarm(updated);
}

function createAgentTask(goal: string, tabId: number, settings: Awaited<ReturnType<typeof getSettings>>): AgentTask {
  return {
    id: crypto.randomUUID(),
    goal,
    tabId,
    status: 'idle',
    steps: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    profile: settings.profile,
    provider: settings.provider,
    modelUsed: modelUsedFromSettings(settings),
  };
}

function modelUsedFromSettings(settings: Awaited<ReturnType<typeof getSettings>>): string | undefined {
  if (settings.provider === 'openai') return settings.openaiModel;
  if (settings.provider === 'xai') return settings.xaiModel;
  if (settings.provider === 'openrouter') return settings.openRouterModel;
  if (settings.provider === 'mlx') return settings.mlxModel;
  return undefined;
}

function nextScheduledRun(repeat: ScheduledTask['repeat'], from: number): number {
  switch (repeat) {
    case 'hourly': return from + 60 * 60 * 1000;
    case 'daily': return from + 24 * 60 * 60 * 1000;
    case 'weekly': return from + 7 * 24 * 60 * 60 * 1000;
    case 'once':
    default: return from;
  }
}

async function waitForTabComplete(tabId: number, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

// ── Hermes Bridge via Native Messaging ──
let hermesPort: chrome.runtime.Port | null = null;
let hermesReconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connectHermesBridge() {
  if (hermesPort) return;

  try {
    hermesPort = chrome.runtime.connectNative('com.weboperator.hermes');
    console.log('[hermes] connected to companion');

    hermesPort.onMessage.addListener(async (msg: any) => {
      if (msg.kind === 'hermes:command') {
        console.log('[hermes] received command:', msg.tool, msg.arguments);
        // Execute the tool via CDP on the active tab
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) {
            hermesPort?.postMessage({ kind: 'hermes:result', commandId: msg.commandId, result: { ok: false, error: 'No active tab' } });
            return;
          }

          const result = await executeHermesTool(tab.id, msg.tool, msg.arguments);
          hermesPort?.postMessage({ kind: 'hermes:result', commandId: msg.commandId, result });
        } catch (err: any) {
          hermesPort?.postMessage({ kind: 'hermes:result', commandId: msg.commandId, result: { ok: false, error: err.message } });
        }
      }
    });

    hermesPort.onDisconnect.addListener(() => {
      const lastError = chrome.runtime.lastError;
      console.log('[hermes] disconnected:', lastError?.message || 'no error');
      hermesPort = null;
      if (hermesReconnectTimer) clearTimeout(hermesReconnectTimer);
      hermesReconnectTimer = setTimeout(connectHermesBridge, 5000);
    });

    // Send initial poll after short delay to let companion init
    setTimeout(() => {
      if (hermesPort) {
        hermesPort.postMessage({ kind: 'hermes:poll' });
      }
    }, 200);
  } catch (err: any) {
    console.warn('[hermes] companion not found:', err.message);
    hermesPort = null;
    if (hermesReconnectTimer) clearTimeout(hermesReconnectTimer);
    hermesReconnectTimer = setTimeout(connectHermesBridge, 10000);
  }
}

async function executeHermesTool(tabId: number, tool: string, args: Record<string, unknown>) {
  const t0 = Date.now();
  const tab = await chrome.tabs.get(tabId);

  switch (tool) {
    case 'navigate': {
      const url = String(args.url || '');
      if (!url) return { ok: false, error: 'Missing url' };
      await chrome.tabs.update(tabId, { url });
      return { ok: true, durationMs: Date.now() - t0 };
    }
    case 'snapshot': {
      // Request snapshot from content script
      const resp = await new Promise<any>((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { kind: 'snapshot:take' }, (r) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(r);
        });
      });
      return { ok: true, data: resp, durationMs: Date.now() - t0 };
    }
    case 'screenshot': {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 });
      return { ok: true, data: dataUrl, durationMs: Date.now() - t0 };
    }
    case 'click': {
      const ref = String(args.ref || '');
      if (!ref) return { ok: false, error: 'Missing ref' };
      const resp = await new Promise<any>((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { kind: 'action:run', action: { name: 'click', arguments: { ref } } }, (r) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(r);
        });
      });
      return { ...resp.result, durationMs: Date.now() - t0 };
    }
    case 'type': {
      const ref = String(args.ref || '');
      const text = String(args.text || '');
      if (!ref || !text) return { ok: false, error: 'Missing ref or text' };
      const resp = await new Promise<any>((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { kind: 'action:run', action: { name: 'type', arguments: { ref, text } } }, (r) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(r);
        });
      });
      return { ...resp.result, durationMs: Date.now() - t0 };
    }
    case 'scroll': {
      const amount = Number(args.amount || 500);
      const resp = await new Promise<any>((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { kind: 'action:run', action: { name: 'scroll', arguments: { amount } } }, (r) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(r);
        });
      });
      return { ...resp.result, durationMs: Date.now() - t0 };
    }
    case 'extract': {
      const resp = await new Promise<any>((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { kind: 'action:run', action: { name: 'extract', arguments: {} } }, (r) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(r);
        });
      });
      return { ...resp.result, durationMs: Date.now() - t0 };
    }
    case 'press': {
      const key = String(args.key || 'Enter');
      const resp = await new Promise<any>((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { kind: 'action:run', action: { name: 'press', arguments: { key } } }, (r) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(r);
        });
      });
      return { ...resp.result, durationMs: Date.now() - t0 };
    }
    case 'done': {
      return { ok: true, summary: args.summary || 'Task complete', durationMs: Date.now() - t0 };
    }
    default:
      return { ok: false, error: `Unknown tool: ${tool}`, durationMs: Date.now() - t0 };
  }
}

// Auto-connect Hermes bridge on startup
setTimeout(connectHermesBridge, 1000);

chrome.alarms?.create?.('agent-heartbeat', { periodInMinutes: 0.5 });
chrome.alarms?.onAlarm.addListener(() => {});
