export type ModelProfile = 'edge' | 'balanced' | 'fast' | 'quality';

export const PROFILE_TO_MODEL: Record<ModelProfile, string> = {
  edge: 'gemma4:e2b',
  balanced: 'gemma4:e4b',
  fast: 'gemma4:26b',
  quality: 'gemma4:31b',
};

/** Resolve the Ollama model: a non-empty free-text override wins over the profile mapping. */
export function resolveOllamaModel(ollamaModelOverride?: string, profileModel?: string): string {
  const override = ollamaModelOverride?.trim();
  return override || profileModel || 'qwen2.5-vl:7b';
}


export type VisualTokenBudget = 70 | 140 | 280 | 560 | 1120;

export interface Settings {
  ollamaUrl: string;
  /** Free-text override. When non-empty, used as the Ollama model instead of the profile mapping (supports any pulled model, e.g. MLX models served by Ollama). */
  ollamaModel: string;
  /**
   * Context window requested from Ollama, in tokens. 0 means the client default. One agent step
   * carrying a snapshot routinely runs past 10k, so the floor matters; the ceiling is the user's
   * memory, which only they know. Values under 4096 are ignored as unusable.
   */
  ollamaNumCtx: number;
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
  /** Automatically activate new tabs opened by the agent so the user follows along. */
  followActiveTab: boolean;
  provider: 'ollama' | 'openai' | 'openai-compatible' | 'anthropic' | 'gemini' | 'xai' | 'openrouter' | 'siliconflow' | 'mlx' | 'deepseek';
  openaiApiKey: string;
  openaiModel: string;
  anthropicApiKey: string;
  anthropicModel: string;
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
  deepseekApiKey: string;
  deepseekModel: string;
  /** Any server speaking the OpenAI chat-completions dialect: LM Studio, vLLM, LiteLLM, a gateway. */
  openAiCompatibleBaseUrl: string;
  openAiCompatibleApiKey: string;
  openAiCompatibleModel: string;
  /** Smart context compression for long tasks. 'off' = deterministic only; 'same' = compress folded history with the active model; 'cloud' = use DeepSeek/Gemini if a key is set. */
  contextCompressor: 'off' | 'same' | 'cloud';
  enabledSkills: SkillId[];
  autoSkills: boolean;
  autoResumeTimeoutMs: number;
  /**
   * Wall-clock budget for one task, or 0 for none. Nothing in the loop behaves differently at
   * step 55 than at step 5, so a run that already holds the answer keeps exploring until whoever
   * is waiting gives up, and everything it collected is thrown away. When a deadline genuinely
   * exists, telling the agent about it lets it land a partial answer instead of nothing.
   */
  taskDeadlineMs: number;
}

export type SkillRisk = 'safe' | 'medium' | 'high';

export interface CustomSkillDefinition {
  id: string;
  name: string;
  summary: string;
  risk: SkillRisk;
  domains: string[];
  keywords: string[];
  /** Skills that solve the same intent differently; only the better-scoring one survives. */
  conflictsWith?: SkillId[];
  prompt: string;
  isCustom?: boolean;
  enabled?: boolean;
  createdAt: number;
}

export type SkillId = string;


export const DEFAULT_SETTINGS: Settings = {
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: '',
  ollamaNumCtx: 0,
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
    'delete', 'remove', 'pay', 'purchase', 'buy', 'checkout',
    'удалить', 'оплатить', 'купить', 'оформить заказ',
  ],

  useActionCache: true,
  cacheTtlDays: 30,
  resetPageOnStart: false,
  followActiveTab: true,
  provider: 'ollama',
  openaiApiKey: '',
  openaiModel: '',
  anthropicApiKey: '',
  anthropicModel: 'claude-3-7-sonnet-20250219',
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
  deepseekApiKey: '',
  deepseekModel: 'deepseek-v4-flash',
  openAiCompatibleBaseUrl: 'http://127.0.0.1:8080/v1',
  openAiCompatibleApiKey: '',
  openAiCompatibleModel: '',
  contextCompressor: 'off',
  enabledSkills: [],
  autoSkills: true,
  autoResumeTimeoutMs: 30_000,
  // Off by default: a person's own task has no deadline until they say so.
  taskDeadlineMs: 0,
};


export const SETTINGS_VERSION = 19;


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
  // Frame the element lives in. Absent or 0 means the top document; for a child frame the
  // bbox is in that frame's own coordinates, not the page's.
  frameId?: number;
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
  | 'batch_actions'
  | 'click' | 'type' | 'press' | 'select' | 'scroll'
  | 'navigate' | 'wait' | 'extract' | 'done'
  | 'open_tab' | 'switch_tab' | 'list_tabs' | 'close_tabs' | 'bookmark_tabs' | 'group_tabs' | 'ungroup_tabs'
  | 'paste_table' | 'fill_cells' | 'select_cell' | 'set_cell'
  | 'define_sheet_contract' | 'read_cells'
  | 'fill_login_credentials'
  | 'solve_captcha'
  | 'upload_attachment'
  | 'read_downloaded_file'
  | 'start_subtask' | 'finish_subtask' | 'fail_subtask' | 'update_task_memory';



export interface ToolCall {
  name: AgentActionName;
  arguments: Record<string, unknown>;
  id?: string;
}

export interface TaskAttachment {
  id: string;
  name: string;
  path: string;
  mimeType?: string;
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

// `stopped` is the user pressing stop, and is deliberately not `failed`: the
// run was cut short on purpose, its evidence is intact, and it can be resumed.
export type TaskStatus = 'idle' | 'planning' | 'running' | 'paused' | 'done' | 'failed' | 'stopped' | 'awaiting_confirm';

/**
 * Why a task is sitting in `paused`. `bot_challenge` means the page put up a
 * verification challenge and the agent handed control back: the person solves
 * it in the live tab. The agent resumes when the challenge disappears; the
 * manual Resume control remains available. The agent does not attempt to
 * defeat the challenge itself.
 */
export interface TaskPauseReason {
  kind: 'bot_challenge';
  challengeType?: 'cloudflare' | 'recaptcha' | 'hcaptcha' | 'image' | 'slider' | 'audio' | 'unknown';
  url: string;
  title: string;
  tabId?: number;
  note: string;
  since: number;
}

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
  pauseReason?: TaskPauseReason;
  /** Summary of what was collected when a run was stopped before finishing. */
  partialSummary?: string;
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
  | { kind: 'task:start'; goal: string; tabId: number; attachments?: TaskAttachment[] }
  | { kind: 'task:pause'; id: string }
  | { kind: 'task:resume'; id: string }
  | { kind: 'task:stop'; id: string }
  | { kind: 'task:ask'; id: string; question: string }
  | { kind: 'task:confirm'; id: string; allow: boolean }
  | { kind: 'task:resume_checkpoint'; id: string }
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
  | { kind: 'schedule:toggle'; id: string; enabled: boolean }
  | { kind: 'custom_skill:list' }
  | { kind: 'custom_skill:save'; skill: Omit<CustomSkillDefinition, 'id' | 'createdAt'> & { id?: string } }
  | { kind: 'custom_skill:delete'; id: string };


export type SWEvent =
  | { kind: 'task:update'; task: AgentTask }
  | { kind: 'task:step'; taskId: string; step: AgentStep }
  | { kind: 'task:error'; taskId: string; error: string }
  | { kind: 'skills:detected'; taskId: string; skills: { id: SkillId; reason: string; auto: boolean }[] };

export type CSMessage =
  | { kind: 'ping' }
  | { kind: 'snapshot:take'; options?: { allElements?: boolean; refPrefix?: string; maxNodes?: number } }
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
  // True only when the model explicitly drove subtasks. Subtasks are never listed
  // in the UI (they mirror the plan steps); only their result/error is surfaced,
  // folded into the matching plan step.
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
  /** Read-only tool ran but brought back nothing usable — why, in the model's words. */
  dataMissing?: string;
  /** Items a read-only tool actually returned, when it returned any. */
  itemsExtracted?: number;
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
