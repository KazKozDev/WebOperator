export type ModelProfile = 'edge' | 'balanced' | 'fast' | 'quality';

export const PROFILE_TO_MODEL: Record<ModelProfile, string> = {
  edge: 'gemma4:e2b',
  balanced: 'gemma4:e4b',
  fast: 'gemma4:26b',
  quality: 'gemma4:31b',
};

export type VisualTokenBudget = 70 | 140 | 280 | 560 | 1120;

export interface Settings {
  ollamaUrl: string;
  profile: ModelProfile;
  planningProfile: ModelProfile | 'same';
  thinkingPolicy: 'auto' | 'always' | 'never';
  screenshotPolicy: 'auto' | 'always' | 'never';
  visualTokenBudget: VisualTokenBudget;
  visualTokenBudgetVerify: VisualTokenBudget;
  actionTimeoutMs: number;
  whitelist: string[];
  blacklist: string[];
  confirmKeywords: string[];
  useActionCache: boolean;
  cacheTtlDays: number;
  // Reload the active tab before starting a task. Off by default: a reload
  // destroys SPA state, filled forms, and scroll position the user may want
  // the agent to act on.
  resetPageOnStart: boolean;
  provider: 'ollama' | 'openai' | 'gemini' | 'xai' | 'openrouter' | 'siliconflow' | 'mlx';
  openaiApiKey: string;
  openaiModel: string;
  geminiApiKey: string;
  geminiModel: string;
  xaiApiKey: string;
  xaiModel: string;
  openRouterApiKey: string;
  openRouterModel: string;
  siliconFlowApiKey: string;
  siliconFlowModel: string;
  mlxApiKey: string;
  mlxModel: string;
  enabledSkills: SkillId[];
  autoSkills: boolean;
  autoResumeTimeoutMs: number;
}

export type SkillId = string;

export const DEFAULT_SETTINGS: Settings = {
  ollamaUrl: 'http://127.0.0.1:11434',
  profile: 'fast',
  planningProfile: 'same',
  thinkingPolicy: 'auto',
  screenshotPolicy: 'auto',
  visualTokenBudget: 280,
  visualTokenBudgetVerify: 560,
  actionTimeoutMs: 10_000,
  whitelist: [],
  blacklist: [],
  confirmKeywords: [
    'delete', 'remove', 'pay', 'submit', 'purchase', 'buy',
    'post', 'tweet', 'reply', 'repost', 'retweet', 'like', 'follow', 'unfollow',
    'publish', 'unpublish', 'story', 'send', 'comment', 'save',
    'удалить', 'оплатить', 'отправить', 'купить', 'заказать',
    'пост', 'твит', 'ответить', 'репост', 'лайк', 'подписаться', 'отписаться',
    'опубликовать', 'публикация', 'снять с публикации', 'комментарий', 'сохранить',
  ],
  useActionCache: true,
  cacheTtlDays: 30,
  resetPageOnStart: false,
  provider: 'ollama',
  openaiApiKey: '',
  openaiModel: '',
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  xaiApiKey: '',
  xaiModel: 'grok-4-1-fast-non-reasoning',
  openRouterApiKey: '',
  openRouterModel: '',
  siliconFlowApiKey: '',
  siliconFlowModel: '',
  mlxApiKey: '',
  mlxModel: '',
  enabledSkills: [],
  autoSkills: true,
  autoResumeTimeoutMs: 30_000,
};

export const SETTINGS_VERSION = 12;

export type A11yRole =
  | 'button' | 'link' | 'textbox' | 'searchbox' | 'combobox'
  | 'checkbox' | 'radio' | 'switch' | 'slider' | 'tab'
  | 'menuitem' | 'option' | 'listbox' | 'heading' | 'image'
  | 'generic' | 'unknown';

export interface A11yNode {
  ref: string;
  role: A11yRole;
  name: string;
  value?: string;
  href?: string;
  state?: string[];
  bbox: { x: number; y: number; w: number; h: number };
  inViewport: boolean;
}

export interface A11ySnapshot {
  url: string;
  title: string;
  viewport: { w: number; h: number; scrollX: number; scrollY: number };
  nodes: A11yNode[];
  textSnippets?: string[];
  domHash: string;
  takenAt: number;
}

export type AgentActionName =
  | 'set_task_plan'
  | 'click' | 'type' | 'press' | 'select' | 'scroll'
  | 'navigate' | 'wait' | 'extract' | 'done'
  | 'open_tab' | 'switch_tab' | 'list_tabs' | 'close_tabs' | 'bookmark_tabs' | 'group_tabs' | 'ungroup_tabs'
  | 'paste_table' | 'fill_cells' | 'select_cell' | 'set_cell'
  | 'define_sheet_contract' | 'read_cells'
  | 'fill_login_credentials'
  | 'start_subtask' | 'finish_subtask' | 'fail_subtask' | 'update_task_memory';

export interface ToolCall {
  name: AgentActionName;
  arguments: Record<string, unknown>;
  id?: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  extracted?: unknown;
  durationMs: number;
}

export interface CredentialEntry {
  id: string;
  origin: string;
  username: string;
  password: string;
  label?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CredentialSummary {
  id: string;
  origin: string;
  username: string;
  label?: string;
  createdAt: number;
  updatedAt: number;
}

export type StepStatus = 'pending' | 'running' | 'ok' | 'fail' | 'skipped';

export interface StepTimings {
  snapshotMs?: number;
  screenshotMs?: number;
  llmMs?: number;
  actionMs?: number;
  totalMs: number;
}

export interface AgentStep {
  id: string;
  index: number;
  status: StepStatus;
  startedAt: number;
  finishedAt?: number;
  snapshot?: A11ySnapshot;
  snapshotAfter?: A11ySnapshot;
  screenshotDataUrl?: string;
  usedVision?: boolean;
  cached?: boolean;
  thought?: boolean;
  needReasoningNext?: boolean;
  modelUsed?: string;
  visualTokens?: number;
  prompt?: string;
  thinking?: string;
  toolCall?: ToolCall;
  result?: ActionResult;
  note?: string;
  timings?: StepTimings;
}

export const LATENCY_TARGETS_MS = {
  stepNoVisionNoThink: 2_000,
  stepWithVisionNoThink: 5_000,
  stepWithThink: 8_000,
  planning: 15_000,
  cacheHit: 500,
  snapshot: 300,
};

export const PROFILE_LATENCY_MULT: Record<ModelProfile, number> = {
  edge: 1.5,
  balanced: 1,
  fast: 0.7,
  quality: 0.9,
};

export type TaskStatus = 'idle' | 'planning' | 'running' | 'paused' | 'done' | 'failed' | 'awaiting_confirm';

export interface AgentTask {
  id: string;
  goal: string;
  tabId: number;
  status: TaskStatus;
  steps: AgentStep[];
  plan?: AgentPlan;
  orchestration?: AgentOrchestrationState;
  createdAt: number;
  updatedAt: number;
  profile: ModelProfile;
  provider?: Settings['provider'];
  modelUsed?: string;
  error?: string;
}

export type ScheduleRepeat = 'once' | 'hourly' | 'daily' | 'weekly';
export type ScheduledTaskStatus = 'enabled' | 'paused' | 'running' | 'last_success' | 'last_failed' | 'needs_user';

export interface ScheduledTask {
  id: string;
  name: string;
  goal: string;
  startUrl: string;
  repeat: ScheduleRepeat;
  enabled: boolean;
  nextRunAt: number;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastTaskId?: string;
  lastStatus?: ScheduledTaskStatus;
  lastError?: string;
}

export type SWMessage =
  | { kind: 'task:start'; goal: string; tabId: number }
  | { kind: 'task:pause'; id: string }
  | { kind: 'task:resume'; id: string }
  | { kind: 'task:stop'; id: string }
  | { kind: 'task:confirm'; id: string; allow: boolean }
  | { kind: 'settings:get' }
  | { kind: 'settings:update'; patch: Partial<Settings> }
  | { kind: 'task:list' }
  | { kind: 'task:get'; id: string }
  | { kind: 'eval:startTask'; goal: string; startUrl?: string; tabId?: number; settingsPatch?: Partial<Settings> }
  | { kind: 'eval:getTask'; id: string }
  | { kind: 'eval:waitTask'; id: string; timeoutMs?: number }
  | { kind: 'eval:clear' }
  | { kind: 'cache:clear' }
  | { kind: 'cache:stats' }
  | { kind: 'credential:list' }
  | { kind: 'credential:set'; entry: Omit<CredentialEntry, 'id' | 'createdAt' | 'updatedAt'> & { id?: string } }
  | { kind: 'credential:delete'; id: string }
  | { kind: 'credential:clear' }
  | { kind: 'schedule:list' }
  | { kind: 'schedule:set'; entry: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt'> & { id?: string } }
  | { kind: 'schedule:delete'; id: string }
  | { kind: 'schedule:run'; id: string }
  | { kind: 'schedule:toggle'; id: string; enabled: boolean };

export type SWEvent =
  | { kind: 'task:update'; task: AgentTask }
  | { kind: 'task:step'; taskId: string; step: AgentStep }
  | { kind: 'task:error'; taskId: string; error: string }
  | { kind: 'skills:detected'; taskId: string; skills: { id: SkillId; reason: string; auto: boolean }[] };

export type CSMessage =
  | { kind: 'snapshot:take'; options?: { allElements?: boolean } }
  | { kind: 'action:run'; action: ToolCall }
  | { kind: 'overlay:show'; refs: string[] }
  | { kind: 'overlay:hide' }
  | { kind: 'agent-glow:set'; active: boolean }
  | { kind: 'som:render'; snapshot: A11ySnapshot }
  | { kind: 'som:clear' };

export type CSResponse =
  | { kind: 'snapshot'; snapshot: A11ySnapshot }
  | { kind: 'action:result'; result: ActionResult }
  | { kind: 'ok' }
  | { kind: 'error'; error: string };

// ── Planner types ──
export interface PlanStep {
  index: number;
  description: string;
  status: 'pending' | 'active' | 'done' | 'failed';
  toolHint?: string;
}

export interface AgentPlan {
  goal: string;
  intent?: string;
  steps: PlanStep[];
  currentStep: number;
  createdAt: number;
}

export interface AgentOrchestrationSubtask {
  id: string;
  index: number;
  description: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  result?: string;
  error?: string;
}

export interface AgentOrchestrationState {
  goal: string;
  status: 'planning' | 'running' | 'paused' | 'done' | 'failed';
  subtasks: AgentOrchestrationSubtask[];
  updatedAt: number;
  // True only when the model explicitly drove subtasks. When false the
  // subtasks merely mirror the plan steps, so the UI hides them as duplicates.
  managed: boolean;
}

// ── Verifier types ──
export type VerifyStatus = 'success' | 'partial' | 'failed' | 'uncertain';
export type RetryStrategy =
  | 'none'
  | 'retry_same'
  | 'different_selector'
  | 'wait_and_retry'
  | 'scroll_to_element'
  | 'coordinates_click'
  | 'close_popup'
  | 'refresh_page'
  | 'try_alternative'
  | 'ask_user';

export interface VerificationResult {
  status: VerifyStatus;
  domChanged: boolean;
  urlChanged: boolean;
  newUrl?: string;
  elementAppeared?: string;
  errorDetected?: string;
  popupDetected?: boolean;
  popupRefs?: string[];
  suggestions: string[];
  recommendedStrategy: RetryStrategy;
}

// ── Semantic memory types ──
export interface SitePattern {
  urlPattern: string;
  searchInputRef?: string;
  searchButtonRef?: string;
  searchSelector?: string;
  cookieAcceptSelector?: string;
  loginButtonSelector?: string;
  logoutSelector?: string;
  languageSelector?: string;
  notes: string;
  updatedAt: number;
  hitCount: number;
}

export interface RecoveryMemory {
  urlPattern: string;
  failedAction: string;
  successAction: string;
  recoveryHint: string;
  hitCount: number;
}
