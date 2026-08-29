import Dexie, { type Table } from 'dexie';
import type { CachedAction } from './action-cache';
import { DEFAULT_SETTINGS, SETTINGS_VERSION, type AgentStep, type AgentTask, type CredentialEntry, type CredentialSummary, type CustomSkillDefinition, type ScheduledTask, type Settings, type SitePattern, type RecoveryMemory } from './types';

import { maskTaskForLog } from './masking';

export class AgentDB extends Dexie {
  tasks!: Table<AgentTask, string>;
  steps!: Table<AgentStep & { taskId: string }, string>;
  actionCache!: Table<CachedAction, string>;
  sitePatterns!: Table<SitePattern, string>;
  recoveryMemory!: Table<RecoveryMemory, string>;

  constructor() {
    super('gemma4-agent');
    this.version(1).stores({
      tasks: 'id, createdAt, status',
      steps: 'id, taskId, index',
    });
    this.version(2).stores({
      tasks: 'id, createdAt, status',
      steps: 'id, taskId, index',
      actionCache: 'key, urlPattern, intentHash, expiresAt',
    });
    this.version(3).stores({
      tasks: 'id, createdAt, status',
      steps: 'id, taskId, index',
      actionCache: 'key, urlPattern, intentHash, expiresAt',
      sitePatterns: 'urlPattern',
      recoveryMemory: 'urlPattern, failedAction',
    });
  }
}

export const db = new AgentDB();

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(['settings', 'settingsVersion']);
  const s = stored?.settings ?? {};
  const storedSettings = s as Partial<Settings> & Record<string, unknown>;
  const next = { ...DEFAULT_SETTINGS, ...s };
  const version = stored?.settingsVersion ?? 0;
  let migrated = false;
  if (version < SETTINGS_VERSION && next.profile === 'balanced') {
    next.profile = DEFAULT_SETTINGS.profile;
    migrated = true;
  }
  if (version < 4) {
    next.confirmKeywords = Array.from(new Set([
      ...(Array.isArray(next.confirmKeywords) ? next.confirmKeywords : []),
      'publish', 'unpublish', 'story', 'send',
      'опубликовать', 'публикация', 'снять с публикации',
    ]));
    migrated = true;
  }
  if (version < 5) {
    next.confirmKeywords = Array.from(new Set([
      ...(Array.isArray(next.confirmKeywords) ? next.confirmKeywords : []),
      'comment', 'save',
      'комментарий', 'сохранить',
    ]));
    next.redditKarma = typeof next.redditKarma === 'object' && next.redditKarma !== null ? next.redditKarma : {};
    migrated = true;
  }
  if (version < 6) {
    next.redditCommunities = Array.isArray(next.redditCommunities) ? next.redditCommunities.slice(0, 4) : [];
    migrated = true;
  }
  if (version < 7) {
    next.openRouterApiKey = typeof next.openRouterApiKey === 'string' ? next.openRouterApiKey : '';
    next.openRouterModel = typeof next.openRouterModel === 'string' ? next.openRouterModel : DEFAULT_SETTINGS.openRouterModel;
    migrated = true;
  }
  if (version < 8) migrated = true;
  if (version < 9) {
    next.mlxApiKey = typeof storedSettings.mlxApiKey === 'string' ? storedSettings.mlxApiKey : '';
    next.mlxModel = typeof storedSettings.mlxModel === 'string' ? storedSettings.mlxModel : DEFAULT_SETTINGS.mlxModel;
    migrated = true;
  }
  if (version < 11) {
    next.geminiApiKey = typeof storedSettings.geminiApiKey === 'string' ? storedSettings.geminiApiKey : '';
    next.geminiModel = typeof storedSettings.geminiModel === 'string' ? storedSettings.geminiModel : DEFAULT_SETTINGS.geminiModel;
    migrated = true;
  }
  if (version < 12) {
    next.ollamaModel = typeof storedSettings.ollamaModel === 'string' ? storedSettings.ollamaModel : DEFAULT_SETTINGS.ollamaModel;
    migrated = true;
  }
  if (version < 13) {
    next.deepseekApiKey = typeof storedSettings.deepseekApiKey === 'string' ? storedSettings.deepseekApiKey : '';
    next.deepseekModel = typeof storedSettings.deepseekModel === 'string' ? storedSettings.deepseekModel : DEFAULT_SETTINGS.deepseekModel;
    migrated = true;
  }
  if (version < 14) {
    next.contextCompressor = storedSettings.contextCompressor === 'same' || storedSettings.contextCompressor === 'cloud'
      ? storedSettings.contextCompressor
      : DEFAULT_SETTINGS.contextCompressor;
    migrated = true;
  }
  if (version < 15) {
    next.anthropicApiKey = typeof storedSettings.anthropicApiKey === 'string' ? storedSettings.anthropicApiKey : '';
    next.anthropicModel = typeof storedSettings.anthropicModel === 'string' ? storedSettings.anthropicModel : DEFAULT_SETTINGS.anthropicModel;
    migrated = true;
  }
  if (migrated) {
    await chrome.storage.local.set({ settings: next, settingsVersion: SETTINGS_VERSION });
  }

  return next;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ settings: next, settingsVersion: SETTINGS_VERSION });
  return next;
}

export async function saveTask(task: AgentTask): Promise<void> {
  await db.tasks.put({ ...maskTaskForLog(task), steps: [] });
}

export async function saveStep(taskId: string, step: AgentStep): Promise<void> {
  await db.steps.put({ ...step, taskId });
}

export async function listTasks(limit = 50): Promise<AgentTask[]> {
  return db.tasks.orderBy('createdAt').reverse().limit(limit).toArray();
}

export async function getTask(id: string): Promise<AgentTask | undefined> {
  return db.tasks.get(id);
}

export async function loadSteps(taskId: string): Promise<AgentStep[]> {
  const rows = await db.steps.where('taskId').equals(taskId).sortBy('index');
  return rows.map((row) => {
    const { taskId: storedTaskId, ...rest } = row;
    void storedTaskId;
    return rest;
  });
}

const CREDENTIALS_KEY = 'vaultCredentials';

export async function listCredentials(): Promise<CredentialSummary[]> {
  const entries = await loadCredentialEntries();
  return entries.map((entry) => ({
    id: entry.id,
    origin: entry.origin,
    username: entry.username,
    label: entry.label,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }));
}

export async function saveCredential(entry: Omit<CredentialEntry, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<CredentialSummary[]> {
  const entries = await loadCredentialEntries();
  const now = Date.now();
  const origin = normalizeOrigin(entry.origin);
  const id = entry.id || crypto.randomUUID();
  const existing = entries.find((item) => item.id === id);
  const nextEntry: CredentialEntry = {
    id,
    origin,
    username: entry.username,
    password: entry.password,
    label: entry.label,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const next = [...entries.filter((item) => item.id !== id && !(item.origin === origin && item.username === entry.username)), nextEntry];
  await chrome.storage.local.set({ [CREDENTIALS_KEY]: next });
  return listCredentials();
}

export async function deleteCredential(id: string): Promise<CredentialSummary[]> {
  const entries = await loadCredentialEntries();
  await chrome.storage.local.set({ [CREDENTIALS_KEY]: entries.filter((entry) => entry.id !== id) });
  return listCredentials();
}

export async function clearCredentials(): Promise<void> {
  await chrome.storage.local.remove(CREDENTIALS_KEY);
}

export async function findCredentialForUrl(url: string): Promise<CredentialEntry | null> {
  const origin = normalizeOrigin(url);
  const entries = await loadCredentialEntries();
  return entries.find((entry) => entry.origin === origin) ?? null;
}

async function loadCredentialEntries(): Promise<CredentialEntry[]> {
  const localRaw = await chrome.storage.local.get([CREDENTIALS_KEY, 'credentialVault', 'sessionCredentials']);
  const localEntries = localRaw?.[CREDENTIALS_KEY] ?? localRaw?.credentialVault ?? localRaw?.sessionCredentials;

  if (Array.isArray(localEntries) && localEntries.length > 0) {
    return localEntries.filter(isCredentialEntry);
  }

  // Support fallback / migration from session storage if any exists
  const sessionRaw = (await chrome.storage.session?.get([CREDENTIALS_KEY, 'credentialVault', 'sessionCredentials']).catch(() => ({}))) as Record<string, unknown> | undefined;
  const sessionEntries = sessionRaw?.[CREDENTIALS_KEY] ?? sessionRaw?.credentialVault ?? sessionRaw?.sessionCredentials;


  if (Array.isArray(sessionEntries) && sessionEntries.length > 0) {
    const validSession = sessionEntries.filter(isCredentialEntry);
    await chrome.storage.local.set({ [CREDENTIALS_KEY]: validSession });
    return validSession;
  }

  return [];
}


function isCredentialEntry(value: unknown): value is CredentialEntry {
  if (!value || typeof value !== 'object') return false;
  const item = value as CredentialEntry;
  return typeof item.id === 'string'
    && typeof item.origin === 'string'
    && typeof item.username === 'string'
    && typeof item.password === 'string'
    && typeof item.createdAt === 'number'
    && typeof item.updatedAt === 'number';
}

function normalizeOrigin(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error('Credential origin is empty');
  const url = raw.startsWith('http://') || raw.startsWith('https://') ? new URL(raw) : new URL(`https://${raw}`);
  return url.origin;
}

const SCHEDULED_TASKS_KEY = 'scheduledTasks';

export async function listScheduledTasks(): Promise<ScheduledTask[]> {
  const entries = await loadScheduledTasks();
  return entries.sort((a, b) => a.nextRunAt - b.nextRunAt);
}

export async function getScheduledTask(id: string): Promise<ScheduledTask | null> {
  const entries = await loadScheduledTasks();
  return entries.find((entry) => entry.id === id) ?? null;
}

export async function saveScheduledTask(entry: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<ScheduledTask[]> {
  const entries = await loadScheduledTasks();
  const now = Date.now();
  const id = entry.id || crypto.randomUUID();
  const existing = entries.find((item) => item.id === id);
  const nextEntry: ScheduledTask = {
    id,
    name: entry.name.trim() || 'Scheduled task',
    goal: entry.goal.trim(),
    startUrl: normalizeHttpUrl(entry.startUrl),
    repeat: entry.repeat,
    enabled: entry.enabled,
    nextRunAt: Number(entry.nextRunAt),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastRunAt: existing?.lastRunAt,
    lastTaskId: existing?.lastTaskId,
    lastStatus: entry.lastStatus ?? existing?.lastStatus,
    lastError: existing?.lastError,
  };
  if (!nextEntry.goal) throw new Error('Scheduled goal is required');
  if (!Number.isFinite(nextEntry.nextRunAt) || nextEntry.nextRunAt <= 0) throw new Error('Scheduled nextRunAt is invalid');
  const next = [...entries.filter((item) => item.id !== id), nextEntry];
  await chrome.storage.local.set({ [SCHEDULED_TASKS_KEY]: next });
  return listScheduledTasks();
}

export async function updateScheduledTask(id: string, patch: Partial<ScheduledTask>): Promise<ScheduledTask | null> {
  const entries = await loadScheduledTasks();
  const existing = entries.find((entry) => entry.id === id);
  if (!existing) return null;
  const nextEntry: ScheduledTask = { ...existing, ...patch, id, updatedAt: Date.now() };
  const next = entries.map((entry) => entry.id === id ? nextEntry : entry);
  await chrome.storage.local.set({ [SCHEDULED_TASKS_KEY]: next });
  return nextEntry;
}

export async function deleteScheduledTask(id: string): Promise<ScheduledTask[]> {
  const entries = await loadScheduledTasks();
  await chrome.storage.local.set({ [SCHEDULED_TASKS_KEY]: entries.filter((entry) => entry.id !== id) });
  return listScheduledTasks();
}

async function loadScheduledTasks(): Promise<ScheduledTask[]> {
  const raw = await chrome.storage.local.get(SCHEDULED_TASKS_KEY);
  const entries = raw[SCHEDULED_TASKS_KEY];
  return Array.isArray(entries) ? entries.filter(isScheduledTask) : [];
}

function isScheduledTask(value: unknown): value is ScheduledTask {
  if (!value || typeof value !== 'object') return false;
  const item = value as ScheduledTask;
  return typeof item.id === 'string'
    && typeof item.name === 'string'
    && typeof item.goal === 'string'
    && typeof item.startUrl === 'string'
    && ['once', 'hourly', 'daily', 'weekly'].includes(item.repeat)
    && typeof item.enabled === 'boolean'
    && typeof item.nextRunAt === 'number'
    && typeof item.createdAt === 'number'
    && typeof item.updatedAt === 'number';
}

function normalizeHttpUrl(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error('Start URL is required');
  const url = raw.startsWith('http://') || raw.startsWith('https://') ? new URL(raw) : new URL(`https://${raw}`);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Start URL must be http or https');
  return url.href;
}

// ---------------------------------------------------------------------------
// Resilient Session State Management (chrome.storage.session)
// ---------------------------------------------------------------------------

export interface AgentSessionState {
  activeTaskId: string | null;
  activeTabId: number | null;
  pausedTaskIds: string[];
  stoppedTaskIds: string[];
}

const DEFAULT_SESSION_STATE: AgentSessionState = {
  activeTaskId: null,
  activeTabId: null,
  pausedTaskIds: [],
  stoppedTaskIds: [],
};

const SESSION_STORAGE_KEY = 'agentSessionState';
let memoryFallbackSessionState: AgentSessionState = { ...DEFAULT_SESSION_STATE };

function getSessionStorageArea(): chrome.storage.StorageArea | null {
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    return chrome.storage.session;
  }
  return null;
}

export async function getSessionState(): Promise<AgentSessionState> {
  const area = getSessionStorageArea();
  if (!area) return { ...memoryFallbackSessionState };
  try {
    const raw = await area.get(SESSION_STORAGE_KEY);
    const data = raw[SESSION_STORAGE_KEY] as Partial<AgentSessionState> | undefined;
    return {
      activeTaskId: data?.activeTaskId ?? null,
      activeTabId: data?.activeTabId ?? null,
      pausedTaskIds: Array.isArray(data?.pausedTaskIds) ? data.pausedTaskIds : [],
      stoppedTaskIds: Array.isArray(data?.stoppedTaskIds) ? data.stoppedTaskIds : [],
    };
  } catch {
    return { ...memoryFallbackSessionState };
  }
}

export async function updateSessionState(patch: Partial<AgentSessionState>): Promise<AgentSessionState> {
  const current = await getSessionState();
  const next: AgentSessionState = {
    ...current,
    ...patch,
    pausedTaskIds: patch.pausedTaskIds ?? current.pausedTaskIds,
    stoppedTaskIds: patch.stoppedTaskIds ?? current.stoppedTaskIds,
  };
  memoryFallbackSessionState = { ...next };
  const area = getSessionStorageArea();
  if (area) {
    try {
      await area.set({ [SESSION_STORAGE_KEY]: next });
    } catch (err) {
      console.warn('[storage] Failed to write session state', err);
    }
  }
  return next;
}

const CUSTOM_SKILLS_KEY = 'custom_skills';

export async function getCustomSkills(): Promise<CustomSkillDefinition[]> {
  try {
    const raw = await chrome.storage.local.get(CUSTOM_SKILLS_KEY);
    const list = raw[CUSTOM_SKILLS_KEY];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveCustomSkill(skill: Omit<CustomSkillDefinition, 'id' | 'createdAt'> & { id?: string }): Promise<CustomSkillDefinition> {
  const current = await getCustomSkills();
  const now = Date.now();
  const id = skill.id || `custom-${now}-${Math.random().toString(36).slice(2, 7)}`;
  const full: CustomSkillDefinition = {
    ...skill,
    id,
    isCustom: true,
    enabled: skill.enabled !== false,
    createdAt: now,
  };
  const existingIdx = current.findIndex((s) => s.id === id);
  const next = existingIdx >= 0 ? [...current.slice(0, existingIdx), full, ...current.slice(existingIdx + 1)] : [...current, full];
  await chrome.storage.local.set({ [CUSTOM_SKILLS_KEY]: next });
  return full;
}

export async function deleteCustomSkill(id: string): Promise<void> {
  const current = await getCustomSkills();
  const next = current.filter((s) => s.id !== id);
  await chrome.storage.local.set({ [CUSTOM_SKILLS_KEY]: next });
}


