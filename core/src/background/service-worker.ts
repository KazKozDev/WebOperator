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
  saveStep,
  listTasks,
  getTask,
  loadSteps,
  updateScheduledTask,
  db,
  getSessionState,
  updateSessionState,
  getCustomSkills,
  saveCustomSkill,
  deleteCustomSkill,
} from '@/lib/storage';

import { clearCache } from '@/lib/action-cache';
import { broadcastEvent, ensureContentScript, onLocalSWEvent, registerPortHost } from '@/lib/messaging';

import { AgentPortHost } from '@/lib/port-channel';
import type { ActionResult, AgentStep, AgentTask, CSResponse, ScheduledTask, SWEvent, SWMessage, ToolCall } from '@/lib/types';
import { frameIdFromRef, takeFrameSnapshot } from '@/lib/frames';
import { solveCaptcha, type CaptchaDetection } from '@/lib/captcha-solver';


type Pending = { allow: boolean | null; resolve: (v: boolean) => void };
type BridgeRequestMessage = { kind?: unknown; type?: unknown; payload?: unknown; id?: unknown };

const state = {
  stopped: new Set<string>(),
  paused: new Set<string>(),
  pendingConfirms: new Map<string, Pending>(),
  runningSchedules: new Set<string>(),
};

// Initialize Port Host for resilient Side Panel connection
const portHost = new AgentPortHost();
registerPortHost(portHost);

portHost.onMessage((msg, port) => {
  if (msg.kind === 'session:attach') {
    if (msg.tabId) {
      void updateSessionState({ activeTabId: msg.tabId });
    }
  } else if (msg.kind === 'sw:message') {
    handle(msg.message).then((result) => {
      try {
        port.postMessage({ type: 'sw:response', result });
      } catch {}
    }).catch((err) => {
      try {
        port.postMessage({ type: 'sw:response', error: err instanceof Error ? err.message : String(err) });
      } catch {}
    });
  }
});

// Restore session state on startup
void getSessionState().then((session) => {
  for (const id of session.pausedTaskIds) state.paused.add(id);
  for (const id of session.stoppedTaskIds) state.stopped.add(id);
});

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
    case 'task:resume_checkpoint': return resumeTaskFromCheckpoint(msg.id);
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
    case 'custom_skill:list': return getCustomSkills();
    case 'custom_skill:save': return saveCustomSkill(msg.skill);
    case 'custom_skill:delete': await deleteCustomSkill(msg.id); return { ok: true };
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
    shouldConfirm: (t: AgentTask) => options.autoConfirm
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

async function resumeTaskFromCheckpoint(taskId: string): Promise<AgentTask> {
  const task = await getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  task.steps = await loadSteps(taskId);
  task.status = 'running';
  task.error = undefined;
  task.updatedAt = Date.now();
  await saveTask(task);

  let tabId = task.tabId;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.id) throw new Error('Tab closed');
  } catch {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active?.id) tabId = active.id;
  }
  task.tabId = tabId;
  await ensureContentScript(tabId);

  const settings = await getSettings();
  state.stopped.delete(taskId);
  state.paused.delete(taskId);

  runTask(task, {
    settings,
    shouldConfirm: (t: AgentTask) =>
      new Promise<boolean>((resolve) => {
        state.pendingConfirms.set(t.id, { allow: null, resolve });
      }).finally(() => { state.pendingConfirms.delete(task.id); }),
    isStopped: (id) => state.stopped.has(id),
    isPaused: (id) => state.paused.has(id),
    requestPause: (id) => state.paused.add(id),
    requestResume: (id) => state.paused.delete(id),
  }).catch((err) => console.error('[agent] resume checkpoint failed', err));

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
  if (settings.provider === 'gemini') return settings.geminiModel;
  if (settings.provider === 'xai') return settings.xaiModel;
  if (settings.provider === 'openrouter') return settings.openRouterModel;
  if (settings.provider === 'siliconflow') return settings.siliconFlowModel;
  if (settings.provider === 'mlx') return settings.mlxModel;
  if (settings.provider === 'deepseek') return settings.deepseekModel;
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

let apiBridgePort: chrome.runtime.Port | null = null;
let apiBridgeReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let apiBridgeKeepAliveTimer: ReturnType<typeof setInterval> | null = null;

onLocalSWEvent((event) => {
  apiBridgePort?.postMessage({ kind: 'bridge:event', event: compactBridgeEvent(event) });
});

function compactBridgeEvent(event: SWEvent): SWEvent {
  if (event.kind === 'task:update') {
    return { ...event, task: { ...event.task, steps: [] } };
  }
  if (event.kind === 'task:step') {
    return { ...event, step: compactStepForBridge(event.step) };
  }
  return event;
}

function compactStepForBridge(step: AgentStep): AgentStep {
  const compact = { ...step };
  delete compact.snapshot;
  delete compact.snapshotAfter;
  delete compact.screenshotDataUrl;
  delete compact.prompt;
  delete compact.thinking;
  return compact;
}

// ── WebOperator local HTTP API bridge via Native Messaging ──
function startApiBridgeKeepAlive() {
  if (apiBridgeKeepAliveTimer) return;
  apiBridgeKeepAliveTimer = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {
      void chrome.runtime.lastError;
    });
  }, 20_000);
}

function stopApiBridgeKeepAlive() {
  if (!apiBridgeKeepAliveTimer) return;
  clearInterval(apiBridgeKeepAliveTimer);
  apiBridgeKeepAliveTimer = null;
}

function connectApiBridge() {
  if (apiBridgePort) return;

  try {
    apiBridgePort = chrome.runtime.connectNative('com.weboperator.bridge');
    console.log('[bridge] connected to local API bridge');
    startApiBridgeKeepAlive();
    apiBridgePort.postMessage({ kind: 'bridge:hello' });

    apiBridgePort.onMessage.addListener(async (rawMsg: unknown) => {
      const msg = rawMsg as BridgeRequestMessage;
      if (msg.kind !== 'bridge:request') return;
      try {
        const result = await executeBridgeRequest(String(msg.type), isRecord(msg.payload) ? msg.payload : {});
        apiBridgePort?.postMessage({ kind: 'bridge:response', id: msg.id, result });
      } catch (err: unknown) {
        apiBridgePort?.postMessage({ kind: 'bridge:response', id: msg.id, error: err instanceof Error ? err.message : String(err) });
      }
    });

    apiBridgePort.onDisconnect.addListener(() => {
      const lastError = chrome.runtime.lastError;
      console.log('[bridge] disconnected:', lastError?.message || 'no error');
      stopApiBridgeKeepAlive();
      apiBridgePort = null;
      if (apiBridgeReconnectTimer) clearTimeout(apiBridgeReconnectTimer);
      apiBridgeReconnectTimer = setTimeout(connectApiBridge, 5000);
    });
  } catch (err: unknown) {
    console.warn('[bridge] local API bridge not found:', err instanceof Error ? err.message : String(err));
    stopApiBridgeKeepAlive();
    apiBridgePort = null;
    if (apiBridgeReconnectTimer) clearTimeout(apiBridgeReconnectTimer);
    apiBridgeReconnectTimer = setTimeout(connectApiBridge, 10000);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

let activeBridgeTask: AgentTask | null = null;
let lastBridgeActionTime = 0;

function describeToolCall(call: ToolCall): string {
  const args = call.arguments || {};
  switch (call.name) {
    case 'navigate': return `Navigate to ${args.url ?? ''}`;
    case 'click': return `Click element ${args.ref || args.selector || ''}`;
    case 'type': return `Type "${args.text ?? ''}" into ${args.ref || 'field'}`;
    case 'press': return `Press key "${args.key ?? 'Enter'}"`;
    case 'scroll': return `Scroll ${args.direction ?? 'down'} (${args.amountPx ?? 500}px)`;
    case 'extract': return `Extract page content`;
    default: return `${call.name}`;
  }
}

async function recordBridgeActionStep(
  tabId: number,
  toolCall: ToolCall,
  goalHint: string,
  executeFn: () => Promise<unknown>
): Promise<unknown> {
  const now = Date.now();
  const settings = await getSettings();

  if (!activeBridgeTask || activeBridgeTask.tabId !== tabId || now - lastBridgeActionTime > 60_000) {
    activeBridgeTask = createAgentTask(goalHint, tabId, settings);
    activeBridgeTask.status = 'running';
    activeBridgeTask.steps = [];
    await saveTask(activeBridgeTask);
    broadcastEvent({ kind: 'task:update', task: activeBridgeTask });
  } else {
    activeBridgeTask.updatedAt = now;
    activeBridgeTask.status = 'running';
    await saveTask(activeBridgeTask);
    broadcastEvent({ kind: 'task:update', task: activeBridgeTask });
  }

  lastBridgeActionTime = now;
  const startTime = Date.now();
  let stepResult: unknown = null;
  let stepError: string | undefined = undefined;

  try {
    stepResult = await executeFn();
    return stepResult;
  } catch (err: unknown) {
    stepError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const durationMs = Date.now() - startTime;
    const actionResult: ActionResult = {
      ok: !stepError,
      error: stepError,
      durationMs,
      extracted: isRecord(stepResult) && 'extracted' in stepResult ? stepResult.extracted : undefined,
    };

    const stepIndex = (activeBridgeTask.steps?.length ?? 0) + 1;
    const step: AgentStep = {
      id: crypto.randomUUID(),
      index: stepIndex,

      status: stepError ? 'fail' : 'ok',
      startedAt: startTime,
      finishedAt: Date.now(),
      thinking: `External Agent: ${describeToolCall(toolCall)}`,
      toolCall,
      result: actionResult,
      note: stepError ? `Error: ${stepError}` : undefined,
    };


    activeBridgeTask.steps = [...(activeBridgeTask.steps ?? []), step];
    activeBridgeTask.status = stepError ? 'failed' : 'done';
    activeBridgeTask.error = stepError;
    activeBridgeTask.updatedAt = Date.now();

    await saveStep(activeBridgeTask.id, step);
    await saveTask(activeBridgeTask);

    broadcastEvent({ kind: 'task:step', taskId: activeBridgeTask.id, step });
    broadcastEvent({ kind: 'task:update', task: activeBridgeTask });
  }

}

async function executeBridgeRequest(type: string, payload: Record<string, unknown>) {
  switch (type) {
    case 'browser.snapshot': {
      const tabId = await activeTabIdFromPayload(payload);
      await ensureContentScript(tabId);
      const snapshot = await takeFrameSnapshot(
        tabId,
        (msg) => chrome.tabs.sendMessage(tabId, msg) as Promise<CSResponse>,
        { allElements: payload.allElements === true },
      );
      return { kind: 'snapshot', snapshot } satisfies CSResponse;
    }
    case 'browser.screenshot': {
      const tab = await activeTabFromPayload(payload);
      if (!tab.id || tab.windowId === undefined) throw new Error('No active tab');
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 });
      return { kind: 'screenshot', dataUrl };
    }
    case 'browser.navigate': {
      const tabId = await activeTabIdFromPayload(payload);
      const url = String(payload.url ?? '');
      if (!url) throw new Error('Missing url');
      const action: ToolCall = { name: 'navigate', arguments: { url } };
      return recordBridgeActionStep(tabId, action, `External Agent: Navigate to ${url}`, async () => {
        await chrome.tabs.update(tabId, { url });
        await waitForTabComplete(tabId);
        return { ok: true, tabId, url };
      });
    }
    case 'browser.click':
    case 'browser.type':
    case 'browser.press':
    case 'browser.scroll':
    case 'browser.extract': {
      const tabId = await activeTabIdFromPayload(payload);
      await ensureContentScript(tabId);
      const action = bridgePayloadToToolCall(type, payload);
      return recordBridgeActionStep(tabId, action, `External Agent: ${describeToolCall(action)}`, async () => {
        const frameId = frameIdFromRef(String(action.arguments.ref ?? ''));
        const resp = frameId === 0
          ? await chrome.tabs.sendMessage(tabId, { kind: 'action:run', action })
          : await chrome.tabs.sendMessage(tabId, { kind: 'action:run', action }, { frameId });
        return resp;
      });
    }
    case 'browser.solve_captcha': {
      const tabId = await activeTabIdFromPayload(payload);
      const captchaType = typeof payload.type === 'string' ? (payload.type as CaptchaDetection['type']) : undefined;
      const action: ToolCall = { name: 'solve_captcha', arguments: { type: captchaType } };
      return recordBridgeActionStep(tabId, action, 'External Agent: solve_captcha', async () => {
        const settings = await getSettings();
        const res = await solveCaptcha(tabId, captchaType, { settings });
        return { ok: res.success, message: res.message, type: res.type };
      });
    }
    case 'tasks.list':
      return listTasks();
    case 'tasks.get': {
      const id = String(payload.id ?? '');
      if (!id) throw new Error('Missing task id');
      const task = await getTask(id);
      if (!task) return null;
      task.steps = await loadSteps(id);
      return task;
    }
    case 'tasks.start': {
      const goal = String(payload.goal ?? payload.prompt ?? '');
      if (!goal) throw new Error('Missing goal');
      let tabId = payload.tabId ? Number(payload.tabId) : undefined;
      const startUrl = payload.startUrl ? String(payload.startUrl) : '';
      if (!tabId && startUrl) {
        const tab = await chrome.tabs.create({ url: startUrl, active: true });
        if (!tab.id) throw new Error('Chrome did not return a tabId');
        tabId = tab.id;
        await waitForTabComplete(tabId);
      }
      if (!tabId) tabId = await activeTabIdFromPayload(payload);
      return startTask(goal, tabId, { autoConfirm: payload.autoConfirm === true });
    }
    case 'tasks.stop': {
      const id = String(payload.id ?? '');
      if (!id) throw new Error('Missing task id');
      state.stopped.add(id);
      state.pendingConfirms.get(id)?.resolve(false);
      return { ok: true };
    }
    case 'tasks.pause': {
      const id = String(payload.id ?? '');
      if (!id) throw new Error('Missing task id');
      state.paused.add(id);
      return { ok: true };
    }
    case 'tasks.resume': {
      const id = String(payload.id ?? '');
      if (!id) throw new Error('Missing task id');
      state.paused.delete(id);
      return { ok: true };
    }
    case 'tasks.confirm': {
      const id = String(payload.id ?? '');
      if (!id) throw new Error('Missing task id');
      state.pendingConfirms.get(id)?.resolve(payload.allow === true);
      return { ok: true };
    }
    case 'tasks.wait': {
      const id = String(payload.id ?? '');
      if (!id) throw new Error('Missing task id');
      return waitForTask(id, Number(payload.timeoutMs ?? 120_000));
    }
    default:
      throw new Error(`Unknown bridge request: ${type}`);
  }
}

async function activeTabFromPayload(payload: Record<string, unknown>): Promise<chrome.tabs.Tab> {
  if (payload.tabId !== undefined) {
    const tab = await chrome.tabs.get(Number(payload.tabId));
    if (!tab?.id) throw new Error(`Tab not found: ${payload.tabId}`);
    return tab;
  }
  let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) {
    const tabs = await chrome.tabs.query({ active: true });
    tab = tabs[0];
  }
  if (!tab?.id) {
    const allTabs = await chrome.tabs.query({});
    tab = allTabs.find((t) => !t.url?.startsWith('chrome-extension://')) || allTabs[0];
  }
  if (!tab?.id) throw new Error('No active tab');
  return tab;
}


async function activeTabIdFromPayload(payload: Record<string, unknown>): Promise<number> {
  const tab = await activeTabFromPayload(payload);
  if (!tab.id) throw new Error('No active tab');
  return tab.id;
}

function bridgePayloadToToolCall(type: string, payload: Record<string, unknown>): ToolCall {
  const resolveRef = () => {
    if (payload.ref !== undefined && payload.ref !== '') return String(payload.ref);
    if (payload.index !== undefined && payload.index !== '') return `@${payload.index}`;
    if (payload.selector !== undefined && payload.selector !== '') return String(payload.selector);
    return '';
  };

  if (type === 'browser.click') {
    return { name: 'click', arguments: { ref: resolveRef(), reason: String(payload.reason ?? 'external api') } };
  }
  if (type === 'browser.type') {
    return {
      name: 'type',
      arguments: {
        ref: resolveRef(),
        text: String(payload.text ?? ''),
        mode: String(payload.mode ?? 'replace'),
        submit: String(payload.submit ?? 'false'),
      },
    };
  }
  if (type === 'browser.press') {
    return {
      name: 'press',
      arguments: {
        key: String(payload.key ?? 'Enter'),
        modifiers: String(payload.modifiers ?? ''),
        ...(resolveRef() ? { ref: resolveRef() } : {}),
      },
    };
  }
  if (type === 'browser.scroll') {
    return {
      name: 'scroll',
      arguments: {
        direction: String(payload.direction ?? 'down'),
        amountPx: typeof payload.amountPx === 'number' ? payload.amountPx : Number(payload.amount ?? 500),
        ...(resolveRef() ? { ref: resolveRef() } : {}),
      },
    };
  }
  if (type === 'browser.extract') {
    return { name: 'extract', arguments: { refs: resolveRef() || String(payload.refs ?? '') } };
  }
  throw new Error(`Unsupported browser action: ${type}`);
}


async function waitForTask(id: string, timeoutMs: number): Promise<AgentTask | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const task = await getTask(id);
    if (!task) return null;
    if (task.status === 'done' || task.status === 'failed' || task.status === 'paused' || task.status === 'awaiting_confirm') {
      task.steps = await loadSteps(id);
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const task = await getTask(id);
  if (task) task.steps = await loadSteps(id);
  return task ?? null;
}

connectApiBridge();
setTimeout(connectApiBridge, 1500);

chrome.alarms?.create?.('agent-heartbeat', { periodInMinutes: 0.5 });
chrome.alarms?.onAlarm.addListener(() => {});
