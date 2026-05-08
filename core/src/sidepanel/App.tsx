import { useEffect, useState } from 'react';
import type { AgentStep, AgentTask, CredentialSummary, ScheduledTask, ScheduleRepeat, Settings, SWEvent } from '@/lib/types';
import { DEFAULT_SETTINGS, PROFILE_TO_MODEL } from '@/lib/types';
import { sendToSW } from '@/lib/messaging';
import { ping } from '@/lib/ollama-client';
import { formatTimings, latencyTarget } from '@/lib/benchmark';
import { buildTrace, downloadJson } from '@/lib/export';
import { BUILT_IN_SKILLS, getSkill, SKILL_META, type ClassifiedSkill } from '@/lib/skills';

type View = 'task' | 'history' | 'skills' | 'vault' | 'schedule';

const logoUrl = chrome.runtime.getURL('public/icons/icon48.png');

export function App() {
  const [view, setView] = useState<View>('task');
  const [goal, setGoal] = useState('');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [task, setTask] = useState<AgentTask | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<{ ok: boolean; models: string[]; error?: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [detectedSkills, setDetectedSkills] = useState<ClassifiedSkill[]>([]);

  useEffect(() => {
    sendToSW<Settings>({ kind: 'settings:get' }).then(setSettings).catch(console.error);
  }, []);

  useEffect(() => {
    if (!settings.ollamaUrl) return;
    const ctrl = new AbortController();
    ping(settings.ollamaUrl, ctrl.signal).then(setOllamaStatus);
    return () => ctrl.abort();
  }, [settings.ollamaUrl]);

  useEffect(() => {
    const handler = (msg: unknown) => {
      if (!msg || typeof msg !== 'object' || !('kind' in msg)) return;
      const evt = msg as SWEvent;
      if (evt.kind === 'task:update') setTask({ ...evt.task });
      if (evt.kind === 'task:step') setTask((t) => t && t.id === evt.taskId ? { ...t, steps: upsertStep(t.steps, evt.step) } : t);
      if (evt.kind === 'skills:detected') setDetectedSkills(evt.skills as ClassifiedSkill[]);
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  async function start(text?: string) {
    const goalToRun = (text ?? goal).trim();
    if (!goalToRun) return;
    setStartError(null);
    setIsStarting(true);
    setDetectedSkills([]);
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.id) throw new Error('No active tab');
      if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
        throw new Error('Chrome does not allow the agent to run on system pages. Open a regular site and try again.');
      }
      await requestTabAccess(tab.url);
      const started = await sendToSW<AgentTask>({ kind: 'task:start', goal: goalToRun, tabId: tab.id });
      setTask(started);
      setView('task');
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsStarting(false);
    }
  }

  async function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    const next = await sendToSW<Settings>({ kind: 'settings:update', patch: { [key]: value } as Partial<Settings> });
    setSettings(next);
  }

  const running = isStarting || task?.status === 'running' || task?.status === 'planning';
  const paused = task?.status === 'paused';
  const needsConfirmation = isConfirmationCheckpoint(task);
  const statusTone = startError || (task?.status === 'failed' && !needsConfirmation) ? 'error' : paused ? 'paused' : running ? 'running' : '';

  return (
    <div className="app">
      <header className="header">
        <h1>
          <span className="brand-mark">
            <img src={logoUrl} alt="" />
            <span className={`brand-status ${statusTone}`} />
          </span>
          WebOperator
        </h1>
        <div className="header-actions">
          <div className="model-chip" title={currentModelLabel(settings)}>
            {compactModelLabel(currentModelLabel(settings))}
          </div>
          <button
            className={`icon-btn settings-icon ${showSettings ? 'active' : ''}`}
            title="Settings"
            aria-label="Settings"
            aria-pressed={showSettings}
            onClick={() => setShowSettings((v) => !v)}
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>

      <nav className="tab-nav" aria-label="Views">
        <button className={view === 'task' && !showSettings ? 'tab-item active' : 'tab-item'} onClick={() => { setView('task'); setShowSettings(false); }}>Task</button>
        <button className={view === 'history' && !showSettings ? 'tab-item active' : 'tab-item'} onClick={() => { setView('history'); setShowSettings(false); }}>History</button>
        <button className={view === 'schedule' && !showSettings ? 'tab-item active' : 'tab-item'} onClick={() => { setView('schedule'); setShowSettings(false); }}>Schedule</button>
        <button className={view === 'skills' && !showSettings ? 'tab-item active' : 'tab-item'} onClick={() => { setView('skills'); setShowSettings(false); }}>Skills</button>
        <button className={view === 'vault' && !showSettings ? 'tab-item active' : 'tab-item'} onClick={() => { setView('vault'); setShowSettings(false); }}>Vault</button>
      </nav>

      {settings.provider === 'ollama' && ollamaStatus && !ollamaStatus.ok && (
        <div className="banner err">
          Ollama unavailable ({ollamaStatus.error}). Run: <code>ollama serve</code> and <code>ollama pull {PROFILE_TO_MODEL[settings.profile]}</code>.
        </div>
      )}
      {settings.provider === 'ollama' && ollamaStatus?.ok && !ollamaStatus.models.some((m) => m.startsWith(PROFILE_TO_MODEL[settings.profile]!.split(':')[0])) && (
        <div className="banner warn">
          Model {PROFILE_TO_MODEL[settings.profile]} is not installed. <code>ollama pull {PROFILE_TO_MODEL[settings.profile]}</code>
        </div>
      )}
      {startError && (
        <div className="banner err">
          Failed to start: {startError}
        </div>
      )}

      {showSettings ? (
        <SettingsPanel settings={settings} updateSetting={updateSetting} />
      ) : view === 'task' ? (
        <TaskView goal={goal} setGoal={setGoal} task={task} start={start} isStarting={isStarting} detectedSkills={detectedSkills} />
      ) : view === 'history' ? (
        <HistoryView onReplay={(goal) => { setGoal(goal); start(goal); }} onOpen={(t) => { setTask(t); setView('task'); }} />
      ) : view === 'schedule' ? (
        <ScheduleView onOpenTask={(t) => { setTask(t); setView('task'); }} />
      ) : view === 'skills' ? (
        <SkillsView settings={settings} updateSetting={updateSetting} />
      ) : (
        <VaultView />
      )}
    </div>
  );
}

function ScheduleView({ onOpenTask }: { onOpenTask: (task: AgentTask) => void }) {
  const [items, setItems] = useState<ScheduledTask[]>([]);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [startUrl, setStartUrl] = useState('');
  const [repeat, setRepeat] = useState<ScheduleRepeat>('once');
  const [runAt, setRunAt] = useState(toDatetimeLocal(Date.now() + 10 * 60 * 1000));
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    refreshSchedules();
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const url = tabs[0]?.url;
      if (url && /^https?:/.test(url)) setStartUrl(url);
    }).catch(() => {});
  }, []);

  async function refreshSchedules() {
    const list = await sendToSW<ScheduledTask[]>({ kind: 'schedule:list' });
    setItems(list);
  }

  async function saveSchedule() {
    setMessage(null);
    try {
      const nextRunAt = new Date(runAt).getTime();
      if (!name.trim()) throw new Error('Name is required');
      if (!goal.trim()) throw new Error('Goal is required');
      if (!startUrl.trim()) throw new Error('Start URL is required');
      if (!Number.isFinite(nextRunAt)) throw new Error('Run time is invalid');
      const list = await sendToSW<ScheduledTask[]>({
        kind: 'schedule:set',
        entry: {
          name: name.trim(),
          goal: goal.trim(),
          startUrl: startUrl.trim(),
          repeat,
          enabled: true,
          nextRunAt,
          lastStatus: 'enabled',
        },
      });
      setItems(list);
      setName('');
      setGoal('');
      setRunAt(toDatetimeLocal(Date.now() + 10 * 60 * 1000));
      setMessage('Scheduled task saved.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleSchedule(item: ScheduledTask) {
    setBusyId(item.id);
    try {
      const list = await sendToSW<ScheduledTask[]>({ kind: 'schedule:toggle', id: item.id, enabled: !item.enabled });
      setItems(list);
    } finally {
      setBusyId(null);
    }
  }

  async function runNow(id: string) {
    setBusyId(id);
    try {
      const list = await sendToSW<ScheduledTask[]>({ kind: 'schedule:run', id });
      setItems(list);
      window.setTimeout(() => { refreshSchedules().catch(console.error); }, 750);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      const list = await sendToSW<ScheduledTask[]>({ kind: 'schedule:delete', id });
      setItems(list);
    } finally {
      setBusyId(null);
    }
  }

  async function openLastTask(id?: string) {
    if (!id) return;
    const full = await sendToSW<AgentTask | null>({ kind: 'task:get', id });
    if (full) onOpenTask(full);
  }

  return (
    <section className="view active page-view settings-view">
      <div className="page-note">Run browser tasks later or on a simple repeat.</div>

      <div className="ui-form settings schedule-form">
        <label>
          Task name
          <input value={name} placeholder="Daily pricing check" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Start URL
          <input value={startUrl} placeholder="https://example.com" onChange={(e) => setStartUrl(e.target.value)} />
        </label>
        <label>
          Run at
          <input type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} />
        </label>
        <label>
          Repeat
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as ScheduleRepeat)}>
            <option value="once">Once</option>
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>
        <label className="schedule-goal-label">
          Goal
          <textarea value={goal} placeholder="What should the agent do when this runs?" onChange={(e) => setGoal(e.target.value)} />
        </label>
        <div className="action-row controls">
          <button className="secondary" onClick={saveSchedule}>Save scheduled task</button>
          <button className="secondary" onClick={refreshSchedules}>Refresh</button>
        </div>
        {message && <div className="settings-note">{message}</div>}
      </div>

      <div className="ui-list history-list schedule-list">
        {items.length === 0 ? (
          <div className="page-empty">No scheduled tasks yet.</div>
        ) : items.map((item) => (
          <div key={item.id} className="ui-list-item history-item">
            <div className="item-head step-head">
              <span className="status-pill">{item.enabled ? item.repeat : 'paused'}</span>
              <span className="item-meta step-detail">{item.lastStatus ?? (item.enabled ? 'enabled' : 'paused')}</span>
            </div>
            <div className="item-title history-goal">{item.name}</div>
            <div className="item-meta step-detail">{item.goal}</div>
            <div className="item-meta step-detail">{item.startUrl}</div>
            <div className="item-meta step-detail">Next: {new Date(item.nextRunAt).toLocaleString()}</div>
            {item.lastRunAt && <div className="item-meta step-detail">Last: {new Date(item.lastRunAt).toLocaleString()}</div>}
            {item.lastError && <div className="item-meta step-detail is-slow">{item.lastError}</div>}
            <div className="action-row controls">
              <button className="secondary" disabled={busyId === item.id} onClick={() => toggleSchedule(item)}>{item.enabled ? 'Pause' : 'Enable'}</button>
              <button className="secondary" disabled={busyId === item.id} onClick={() => runNow(item.id)}>Run now</button>
              <button className="secondary" disabled={!item.lastTaskId} onClick={() => openLastTask(item.lastTaskId)}>Open last</button>
              <button className="danger" disabled={busyId === item.id} onClick={() => remove(item.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Icon({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  return <span className={`i i-${name} ${size === 'sm' ? 'i-sm' : ''}`} aria-hidden="true" />;
}

async function requestTabAccess(url?: string): Promise<void> {
  if (!url) throw new Error('The active tab has no URL');
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Chrome does not allow the agent to operate on URLs of type ${parsed.protocol}`);
  }

  const origin = `${parsed.origin}/*`;
  const hasAccess = await chrome.permissions.contains({ origins: [origin] });
  if (hasAccess) return;

  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    throw new Error(`Access to ${parsed.origin} is required to read the page and perform actions.`);
  }
}

function TaskView({ goal, setGoal, task, start, isStarting, detectedSkills }: {
  goal: string;
  setGoal: (g: string) => void;
  task: AgentTask | null;
  start: (text?: string) => void;
  isStarting: boolean;
  detectedSkills: ClassifiedSkill[];
}) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(true);
  const running = isStarting || task?.status === 'running' || task?.status === 'planning';
  const paused = task?.status === 'paused';
  const awaitingConfirm = task?.status === 'awaiting_confirm';
  const selectedStep = task?.steps.find((s) => s.id === selectedStepId) ?? null;
  const finalAnswer = getTaskAnswer(task);

  useEffect(() => {
    if (!task) {
      setTraceOpen(true);
      return;
    }
    setTraceOpen(task.status === 'running' || task.status === 'planning' || task.status === 'awaiting_confirm');
  }, [task?.id, task?.status]);

  return (
    <section className="view active task-view">
      <div className="task-scroll">
        {!task?.steps.length ? (
          <div className="empty-state">
            <div className="empty-intro">Describe a goal in plain language and the agent will drive the active tab to reach it. Try one of these to start:</div>
            <div className="prompt-cloud">
              <div className="prompt-chip-wrap">
                <button className="prompt-chip" onClick={() => setGoal('Open the current page and briefly summarize the key points')}>Summarize the current page</button>
                <button className="prompt-chip" onClick={() => setGoal('Scroll through the page and take a screenshot of what you see')}>Scroll and screenshot the page</button>
                <button className="prompt-chip" onClick={() => setGoal('Compare information across the currently open tabs')}>Compare info across tabs</button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <AnswerPanel answer={finalAnswer} task={task} />
            <PlanPanel task={task} />
            {detectedSkills.length > 0 && (
              <div className="detected-skills">
                {detectedSkills.map((ds) => {
                  const skill = getSkill(ds.id);
                  const meta = SKILL_META[ds.id];
                  return (
                    <span key={ds.id} className={`skill-chip skill-chip--${skill?.risk ?? 'safe'}`} title={skill?.name ?? ds.id}>
                      <span className="chip-label">{meta?.abbr ?? ds.id}</span>
                    </span>
                  );
                })}
              </div>
            )}
            <details className="trace-collapse" open={traceOpen} onToggle={(e) => setTraceOpen(e.currentTarget.open)}>
              <summary>
                <span className="trace-title">Reasoning chain</span>
                <span className="trace-meta">{task.steps.length} steps</span>
              </summary>
              <div className="steps-container">
                {task.steps.map((s) => <StepRow key={s.id} step={s} profile={task.profile} onOpen={() => setSelectedStepId(s.id)} />)}
              </div>
            </details>
          </>
        )}
      </div>

      {awaitingConfirm && task && (
        <ConfirmBox task={task} onDecide={(allow) => sendToSW({ kind: 'task:confirm', id: task.id, allow })} />
      )}

      <div className="input-area">
        <div className="input-row">
          <div className="input-main">
            <textarea
              className="goal-input"
              placeholder="Tell your browser what to do"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void start(); }
              }}
              disabled={running}
            />
            <div className="composer-actions">
              <span className="composer-spacer" />
              <button className="text-btn" onClick={() => task && sendToSW({ kind: paused ? 'task:resume' : 'task:pause', id: task.id })} disabled={!running && !paused}>
                {paused ? 'Resume' : 'Pause'}
              </button>
              {task && <button className="text-btn" onClick={() => downloadJson(`trace-${task.id.slice(0, 8)}.json`, buildTrace(task))}>Export</button>}
            </div>
          </div>
          <button
            className={`send-btn ${running || paused ? 'stop' : ''}`}
            title={running || paused ? 'Stop' : 'Start'}
            aria-label={running || paused ? 'Stop' : 'Start'}
            onClick={() => running || paused ? task && sendToSW({ kind: 'task:stop', id: task.id }) : start()}
            disabled={isStarting || (!task && !goal.trim())}
          >
            <Icon name={running || paused ? 'stop' : 'send'} />
          </button>
        </div>
        <div className="composer-disclaimer">WebOperator can make mistakes. Please double-check responses.</div>
      </div>

      {selectedStep && (
        <StepDetails step={selectedStep} onClose={() => setSelectedStepId(null)} />
      )}
    </section>
  );
}

function PlanPanel({ task }: { task: AgentTask }) {
  const plan = task.plan;
  const orchestration = task.orchestration;
  const lastTool = task.steps.slice().reverse().find((step) => step.toolCall)?.toolCall;
  if (!plan && !orchestration) return null;

  const done = plan?.steps.filter((step) => step.status === 'done').length ?? 0;
  const total = plan?.steps.length ?? 0;
  const active = plan?.steps.find((step) => step.status === 'active');

  return (
    <section className="plan-panel">
      <div className="plan-head">
        <span className="plan-title">Plan</span>
        {plan && <span className="plan-meta">{done}/{total} done</span>}
      </div>
      {active ? (
        <div className="plan-current">
          <span>Current</span>
          <strong>{active.description}</strong>
        </div>
      ) : plan && total > 0 ? (
        <div className="plan-current">
          <span>Status</span>
          <strong>{done === total ? 'Complete' : 'No active step'}</strong>
        </div>
      ) : null}
      {plan?.intent && (
        <div className="plan-current">
          <span>Intent</span>
          <strong>{plan.intent}</strong>
        </div>
      )}
      {lastTool && (
        <div className="plan-current plan-action">
          <span>Last action</span>
          <strong>{lastTool.name}</strong>
        </div>
      )}
      {plan && (
        <ol className="plan-list">
          {plan.steps.map((step) => (
            <li key={`${step.index}-${step.description}`} className={`plan-step ${step.status}`}>
              <span className="plan-step-index">{step.index}</span>
              <span className="plan-step-text">{step.description}</span>
              <span className="plan-step-status">{step.status}</span>
            </li>
          ))}
        </ol>
      )}
      {orchestration && orchestration.subtasks.length > 0 && (
        <div className="subtask-block">
          <div className="subtask-title">Subtasks</div>
          {orchestration.subtasks.map((subtask) => (
            <div key={subtask.id} className={`subtask-row ${subtask.status}`}>
              <span className="plan-step-index">{subtask.index}</span>
              <span className="plan-step-text">{subtask.description}</span>
              <span className="plan-step-status">{subtask.status}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AnswerPanel({ answer, task }: { answer: string | null; task: AgentTask }) {
  const isFinished = task.status === 'done' || task.status === 'failed';
  const needsConfirmation = isConfirmationCheckpoint(task);
  const tone = needsConfirmation ? 'confirm' : task.status === 'failed' ? 'failure' : task.status === 'done' ? 'success' : 'pending';
  const fallback = task.status === 'failed'
    ? 'Task stopped before producing a final answer.'
    : 'Waiting for the final answer...';

  return (
    <section className={`answer-panel ${tone}`}>
      <div className="answer-label">{needsConfirmation ? 'Needs confirmation' : isFinished ? 'Answer' : 'Answer pending'}</div>
      <div className="answer-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(answer ?? fallback) }} />
    </section>
  );
}

function HistoryView({ onReplay, onOpen }: { onReplay: (goal: string) => void; onOpen: (t: AgentTask) => void }) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sendToSW<AgentTask[]>({ kind: 'task:list' }).then((list) => { setTasks(list); setLoading(false); });
  }, []);

  async function openTask(id: string) {
    const full = await sendToSW<AgentTask | null>({ kind: 'task:get', id });
    if (full) onOpen(full);
  }

  async function exportTask(id: string) {
    const full = await sendToSW<AgentTask | null>({ kind: 'task:get', id });
    if (full) downloadJson(`trace-${full.id.slice(0, 8)}.json`, buildTrace(full));
  }

  if (loading) return <section className="view active page-view"><div className="page-empty">Loading...</div></section>;
  if (tasks.length === 0) return <section className="view active page-view"><div className="page-empty">History is empty</div></section>;

  return (
    <section className="view active page-view history-view">
      <div className="page-note">Past tasks the agent has run. Open one to inspect its trace, or replay its goal.</div>
      <div className="ui-list history-list">
      {tasks.map((t) => (
        <div key={t.id} className="ui-list-item history-item">
          <div className="item-head step-head">
            <span className="status-pill">{t.status}</span>
            <span className="item-meta step-detail">{new Date(t.createdAt).toLocaleString()}</span>
          </div>
          <div className="item-title history-goal">{t.goal}</div>
          <div className="action-row controls">
            <button className="secondary" onClick={() => openTask(t.id)}>Open</button>
            <button className="secondary" onClick={() => onReplay(t.goal)}>Replay</button>
            <button className="secondary" onClick={() => exportTask(t.id)}>Export</button>
          </div>
        </div>
      ))}
      </div>
    </section>
  );
}

function SkillsView({ settings, updateSetting }: {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  const enabled = new Set(settings.enabledSkills ?? []);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleSkill(id: Settings['enabledSkills'][number]) {
    const next = enabled.has(id)
      ? (settings.enabledSkills ?? []).filter((skillId) => skillId !== id)
      : [...(settings.enabledSkills ?? []), id];
    updateSetting('enabledSkills', next);
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <section className="view active page-view skills-view">
      <div className="page-note">Skills give the agent reusable playbooks for common sites. Toggle one on and the agent will follow its rules whenever the goal matches.</div>
      <div className="ui-list skills-list">
        {BUILT_IN_SKILLS.length === 0 ? (
          <div className="page-empty">No skills installed. Custom skills coming soon.</div>
        ) : (
          BUILT_IN_SKILLS.map((skill) => {
            const active = enabled.has(skill.id);
            const open = expanded.has(skill.id);
            return (
              <article key={skill.id} className={`ui-list-item skill-card ${active ? 'active' : ''}`}>
                <div className="skill-row" onClick={() => toggleExpand(skill.id)}>
                  <span className="item-title skill-title">{skill.name}</span>
                  <button
                    className={`toggle ${active ? 'on' : ''}`}
                    role="switch"
                    aria-checked={active}
                    onClick={(e) => { e.stopPropagation(); toggleSkill(skill.id); }}
                  >
                    <span />
                  </button>
                </div>
                {open && (
                  <div className="skill-detail">
                    <p className="item-meta skill-desc">{skill.summary}</p>
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

function VaultView() {
  const [entries, setEntries] = useState<CredentialSummary[]>([]);
  const [origin, setOrigin] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    sendToSW<CredentialSummary[]>({ kind: 'credential:list' }).then(setEntries).catch((err) => setMessage(String(err)));
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const url = tabs[0]?.url;
      if (!url || !/^https?:/.test(url)) return;
      setOrigin(new URL(url).origin);
    }).catch(() => {});
  }, []);

  async function save() {
    setMessage(null);
    try {
      if (!origin.trim()) throw new Error('Origin is required');
      if (!username.trim()) throw new Error('Username is required');
      if (!password) throw new Error('Password is required');
      const next = await sendToSW<CredentialSummary[]>({
        kind: 'credential:set',
        entry: { origin: origin.trim(), username: username.trim(), password, label: label.trim() || undefined },
      });
      setEntries(next);
      setPassword('');
      setMessage('Saved for this browser session.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function remove(id: string) {
    const next = await sendToSW<CredentialSummary[]>({ kind: 'credential:delete', id });
    setEntries(next);
  }

  async function clear() {
    await sendToSW({ kind: 'credential:clear' });
    setEntries([]);
    setMessage('Vault cleared.');
  }

  return (
    <section className="view active page-view settings-view">
      <div className="vault-note">
        <Icon name="info" />
        <div>
          <strong>Session-only storage.</strong> Credentials live in memory for this browser session and are wiped when Chrome closes. Passwords are never sent to the model — only typed into the page when an action requires them.
        </div>
      </div>
      <div className="ui-form settings">
        <label>
          Site origin
          <input value={origin} placeholder="https://example.com" onChange={(e) => setOrigin(e.target.value)} />
        </label>
        <label>
          Username / email
          <input value={username} autoComplete="username" onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label>
          Label
          <input value={label} placeholder="optional" onChange={(e) => setLabel(e.target.value)} />
        </label>
        <div className="action-row controls">
          <button className="secondary" onClick={save}>Save session credential</button>
          <button className="secondary" onClick={clear} disabled={entries.length === 0}>Clear vault</button>
        </div>
        {message && <div className="settings-note">{message}</div>}
      </div>

      <div className="ui-list history-list">
        {entries.length === 0 ? (
          <div className="page-empty">No session credentials saved.</div>
        ) : entries.map((entry) => (
          <div key={entry.id} className="ui-list-item history-item">
            <div className="item-head step-head">
              <span className="status-pill">{entry.label || 'Credential'}</span>
              <span className="item-meta step-detail">{new Date(entry.updatedAt).toLocaleString()}</span>
            </div>
            <div className="item-title history-goal">{entry.origin}</div>
            <div className="item-meta step-detail">{entry.username} · password saved for session</div>
            <div className="action-row controls">
              <button className="secondary" onClick={() => remove(entry.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsPanel({ settings, updateSetting }: {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  return (
    <section className="view active page-view settings-view">
      <div className="ui-form settings">
      <label>
        Provider
        <select value={settings.provider} onChange={(e) => updateSetting('provider', e.target.value as Settings['provider'])}>
          <option value="ollama">Ollama (Local)</option>
          <option value="mlx">MLX (Local)</option>
          <option value="openai">OpenAI</option>
          <option value="xai">xAI</option>
          <option value="openrouter">OpenRouter</option>
        </select>
      </label>
      <div className="settings-note">
        Local providers run on your machine — nothing leaves the device. Cloud providers send page snapshots and screenshots to a third party.
      </div>

      {settings.provider === 'ollama' && (
        <>
          <label>
            Ollama URL
            <input value={settings.ollamaUrl} onChange={(e) => updateSetting('ollamaUrl', e.target.value)} />
          </label>
          <div className="settings-note">
            If you see <code>403 Forbidden</code>, restart Ollama with <code>OLLAMA_ORIGINS="chrome-extension://*,http://localhost:*" ollama serve</code>. On macOS quit the menu-bar Ollama first.
          </div>
        </>
      )}

      {settings.provider === 'openai' && (
        <>
          <label>
            OpenAI API Key
            <input type="password" value={settings.openaiApiKey} onChange={(e) => updateSetting('openaiApiKey', e.target.value)} placeholder="sk-..." />
          </label>
          <label>
            OpenAI Model
            <input value={settings.openaiModel} onChange={(e) => updateSetting('openaiModel', e.target.value)} placeholder="e.g. gpt-5-mini" />
          </label>
          <div className="settings-note">
            Get a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a>. Model must support vision + function calling.
          </div>
        </>
      )}

      {settings.provider === 'xai' && (
        <>
          <label>
            xAI API Key
            <input type="password" value={settings.xaiApiKey} onChange={(e) => updateSetting('xaiApiKey', e.target.value)} placeholder="xai-..." />
          </label>
          <label>
            xAI Model
            <input value={settings.xaiModel} onChange={(e) => updateSetting('xaiModel', e.target.value)} placeholder="e.g. grok-4-1-fast-non-reasoning" />
          </label>
          <div className="settings-note">
            Get a key at <a href="https://console.x.ai" target="_blank" rel="noreferrer">console.x.ai</a>.
          </div>
        </>
      )}

      {settings.provider === 'openrouter' && (
        <>
          <label>
            OpenRouter API Key
            <input type="password" value={settings.openRouterApiKey} onChange={(e) => updateSetting('openRouterApiKey', e.target.value)} placeholder="sk-or-..." />
          </label>
          <label>
            OpenRouter Model
            <input value={settings.openRouterModel} onChange={(e) => updateSetting('openRouterModel', e.target.value)} placeholder="e.g. google/gemma-4-31b-it" />
          </label>
          <div className="settings-note">
            Get a key at <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a>. Free endpoints can be entered manually if available.
          </div>
        </>
      )}

      {settings.provider === 'mlx' && (
        <>
          <label>
            MLX API Key (optional)
            <input type="password" value={settings.mlxApiKey} onChange={(e) => updateSetting('mlxApiKey', e.target.value)} />
          </label>
          <label>
            MLX Model
            <input value={settings.mlxModel} onChange={(e) => updateSetting('mlxModel', e.target.value)} placeholder="e.g. mlx-community/Qwen2.5-VL-7B-Instruct-4bit" />
          </label>
          <div className="settings-note">
            Local MLX server expected at <code>http://127.0.0.1:8000</code>. Model must support function calling + vision.
          </div>
        </>
      )}

      {settings.provider === 'ollama' && (
        <>
          <label>
            Profile
            <select value={settings.profile} onChange={(e) => updateSetting('profile', e.target.value as Settings['profile'])}>
              <option value="edge">Edge — gemma4:e2b</option>
              <option value="balanced">Balanced — gemma4:e4b</option>
              <option value="fast">Fast — gemma4:26b</option>
              <option value="quality">Quality — gemma4:31b</option>
            </select>
          </label>
          <label>
            Planning profile
            <select value={settings.planningProfile} onChange={(e) => updateSetting('planningProfile', e.target.value as Settings['planningProfile'])}>
              <option value="same">same as main</option>
              <option value="edge">Edge</option>
              <option value="balanced">Balanced</option>
              <option value="fast">Fast</option>
              <option value="quality">Quality</option>
            </select>
          </label>
        </>
      )}
      <label>
        Vision
        <select value={settings.screenshotPolicy} onChange={(e) => updateSetting('screenshotPolicy', e.target.value as Settings['screenshotPolicy'])}>
          <option value="auto">Auto</option>
          <option value="always">Always</option>
          <option value="never">Never</option>
        </select>
      </label>
      <label>
        Timeout, ms
        <input type="number" value={settings.actionTimeoutMs} onChange={(e) => updateSetting('actionTimeoutMs', Number(e.target.value))} />
      </label>
      <details className="settings-advanced">
        <summary>Advanced</summary>
        <label>
          Thinking
          <select value={settings.thinkingPolicy} onChange={(e) => updateSetting('thinkingPolicy', e.target.value as Settings['thinkingPolicy'])}>
            <option value="auto">Auto</option>
            <option value="always">Always</option>
            <option value="never">Never</option>
          </select>
        </label>
        <label>
          Vision budget
          <select value={settings.visualTokenBudget} onChange={(e) => updateSetting('visualTokenBudget', Number(e.target.value) as Settings['visualTokenBudget'])}>
            {[70, 140, 280, 560, 1120].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>
          Verification vision budget
          <select value={settings.visualTokenBudgetVerify} onChange={(e) => updateSetting('visualTokenBudgetVerify', Number(e.target.value) as Settings['visualTokenBudgetVerify'])}>
            {[70, 140, 280, 560, 1120].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>
          Domain whitelist
          <input
            value={settings.whitelist.join(', ')}
            placeholder="example.com, *.mysite.org"
            onChange={(e) => updateSetting('whitelist', splitList(e.target.value))}
          />
        </label>
        <label>
          Domain blacklist
          <input
            value={settings.blacklist.join(', ')}
            placeholder="bank.com, *.paypal.com"
            onChange={(e) => updateSetting('blacklist', splitList(e.target.value))}
          />
        </label>
        <label>
          Action cache
          <input type="checkbox" checked={settings.useActionCache} onChange={(e) => updateSetting('useActionCache', e.target.checked)} />
        </label>
        <label>
          Cache TTL, days
          <input type="number" min={1} max={365} value={settings.cacheTtlDays} onChange={(e) => updateSetting('cacheTtlDays', Number(e.target.value))} />
        </label>
        <div className="action-row controls">
          <button className="secondary" onClick={async () => {
            const res = await sendToSW<{ ok: boolean; removed: number }>({ kind: 'cache:clear' });
            alert(`Removed entries: ${res.removed}`);
          }}>Clear action cache</button>
        </div>
      </details>
      </div>
    </section>
  );
}

function upsertStep(steps: AgentStep[], step: AgentStep): AgentStep[] {
  const idx = steps.findIndex((s) => s.id === step.id);
  if (idx < 0) return [...steps, step];
  const next = steps.slice();
  next[idx] = step;
  return next;
}

function getTaskAnswer(task: AgentTask | null): string | null {
  if (!task) return null;
  const doneStep = task.steps.slice().reverse().find((step) => step.toolCall?.name === 'done');
  const summary = doneStep?.result?.extracted ?? doneStep?.toolCall?.arguments.summary;
  if (summary !== undefined && summary !== null && summary !== '') return formatAnswer(summary);

  if (task.status === 'failed') {
    const failedStep = task.steps.slice().reverse().find((step) => step.status === 'fail' || step.result?.error);
    if (failedStep?.result?.error) return failedStep.result.error;
  }

  return null;
}

function isConfirmationCheckpoint(task: AgentTask | null): boolean {
  if (!task || task.status !== 'failed') return false;
  const answer = getTaskAnswer(task);
  if (!answer) return false;
  const normalized = answer.toLowerCase();
  if (
    normalized.includes('не удалось') ||
    normalized.includes('not found') ||
    normalized.includes('could not find') ||
    normalized.includes('unable to find') ||
    normalized.includes('login wall') ||
    normalized.includes('requires login')
  ) {
    return false;
  }
  return [
    'подтверд',
    'требуется подтверждение',
    'confirmation',
    'confirm',
    'extension will confirm',
    'extension can show the confirmation',
    'extension confirmation',
    'final click',
    'critical action',
    'кликнуть',
  ].some((marker) => normalized.includes(marker));
}

function formatAnswer(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function currentModelLabel(settings: Settings): string {
  if (settings.provider === 'openai') return settings.openaiModel;
  if (settings.provider === 'xai') return settings.xaiModel;
  if (settings.provider === 'openrouter') return settings.openRouterModel;
  if (settings.provider === 'mlx') return settings.mlxModel;
  return PROFILE_TO_MODEL[settings.profile];
}

function compactModelLabel(value: string): string {
  const cleaned = value
    .replace(/^google\//, '')
    .replace(/^mlx-community\//, '')
    .replace(/-/g, ' ')
    .replace(/\bnon reasoning\b/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^gpt 5 mini$/i.test(cleaned)) return 'GPT-5 Mini';
  if (/^grok 4 1 fast/i.test(cleaned)) return 'Grok 4.1 Fast';
  if (/gemma 4 31b/i.test(cleaned)) return 'Gemma 4 31B';
  if (/qwen2\.5 vl/i.test(cleaned)) return 'Qwen2.5 VL';
  return cleaned.length > 22 ? `${cleaned.slice(0, 21)}…` : cleaned;
}

function StepRow({ step, profile, onOpen }: { step: AgentStep; profile: AgentTask['profile']; onOpen: () => void }) {
  const name = step.toolCall?.name ?? (step.status === 'running' ? '…' : '—');
  const args = step.toolCall ? Object.entries(step.toolCall.arguments).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : '';
  const badges: string[] = [];
  if (step.cached) badges.push('cache');
  if (step.usedVision) badges.push(`vision:${step.visualTokens ?? ''}`);
  if (step.thought) badges.push('think');
  if (step.needReasoningNext) badges.push('→reason');
  const lat = latencyTarget(step, profile);
  const statusIcon = step.status === 'ok' ? 'check-circle' : step.status === 'fail' ? 'x-circle' : step.status === 'running' ? 'bolt' : 'info';
  return (
    <button className={`step step-button ${step.status === 'fail' ? 'error' : step.status === 'running' ? 'thinking' : 'action'}`} onClick={onOpen}>
      <div className="step-header">
        <Icon name={statusIcon} />
        <span className="step-index">#{step.index + 1}</span>
        <span className="tool-name">{name}</span>
        <span className={`step-status ${step.status}`}>{step.status}</span>
      </div>
      {badges.length > 0 && <div className="step-badges">{badges.join(' · ')}</div>}
      {args && <div className="step-detail">{args}</div>}
      {step.timings && (
        <div className={`step-detail ${lat.exceeds ? 'is-slow' : 'is-fast'}`}>
          {formatTimings(step.timings)} · budget {lat.label} {lat.budgetMs}ms
        </div>
      )}
      {step.result?.error && <div className="step-detail" style={{ color: '#f66' }}>{step.result.error}</div>}
      {step.result?.extracted !== undefined && (
        <pre className="step-extracted">{formatExtracted(step.result.extracted)}</pre>
      )}
      {step.note && <div className="step-detail">{step.note}</div>}
      {step.screenshotDataUrl && (
        <img src={step.screenshotDataUrl} alt="viewport" style={{ maxWidth: '100%', marginTop: 4, borderRadius: 2 }} />
      )}
    </button>
  );
}

function StepDetails({ step, onClose }: { step: AgentStep; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Step #{step.index + 1}</strong>
          <button className="icon-btn" title="Close" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        <DetailBlock title="Tool call" value={step.toolCall} />
        <DetailBlock title="Result" value={step.result} />
        <DetailBlock title="Prompt" value={step.prompt} />
        <DetailBlock title="Thinking" value={step.thinking} />
        <DetailBlock title="Snapshot before" value={step.snapshot} />
        <DetailBlock title="Snapshot after" value={step.snapshotAfter} />
        {step.screenshotDataUrl && (
          <div className="detail-block">
            <strong>Screenshot</strong>
            <img src={step.screenshotDataUrl} alt="viewport" />
          </div>
        )}
      </div>
    </div>
  );
}

function DetailBlock({ title, value }: { title: string; value: unknown }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="detail-block">
      <strong>{title}</strong>
      <pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

function formatExtracted(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length > 2_000 ? `${text.slice(0, 2_000)}...` : text;
}

function splitList(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

function toDatetimeLocal(timestamp: number): string {
  const date = new Date(timestamp);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function ConfirmBox({ task, onDecide }: { task: AgentTask; onDecide: (allow: boolean) => void }) {
  const step = task.steps[task.steps.length - 1];
  const call = step?.toolCall;
  const summary = describeToolCall(call);
  return (
    <div className="confirm-box">
      <strong>Confirmation required</strong>
      <div className="confirm-summary">{summary}</div>
      {call && (
        <details className="confirm-details">
          <summary>Show technical details</summary>
          <code>{call.name} {JSON.stringify(call.arguments)}</code>
        </details>
      )}
      <div className="controls">
        <button onClick={() => onDecide(true)}>Allow</button>
        <button className="danger" onClick={() => onDecide(false)}>Cancel</button>
      </div>
    </div>
  );
}

function describeToolCall(call: AgentStep['toolCall'] | undefined): string {
  if (!call) return 'The agent is waiting for your approval to continue.';
  const args = (call.arguments ?? {}) as Record<string, unknown>;
  const reason = typeof args.reason === 'string' ? args.reason : '';
  switch (call.name) {
    case 'set_task_plan':
      return `Set the visible task plan${reason ? ` — ${reason}` : ''}.`;
    case 'click': {
      const label = typeof args.label === 'string' ? args.label : (typeof args.ref === 'string' ? args.ref : 'an element');
      return `Click ${label}${reason ? ` — ${reason}` : ''}.`;
    }
    case 'type': {
      const label = typeof args.label === 'string' ? args.label : (typeof args.ref === 'string' ? args.ref : 'a field');
      const text = typeof args.text === 'string' ? `"${args.text.length > 80 ? args.text.slice(0, 80) + '…' : args.text}"` : 'some text';
      return `Type ${text} into ${label}${reason ? ` — ${reason}` : ''}.`;
    }
    case 'navigate': {
      const url = typeof args.url === 'string' ? args.url : 'a new URL';
      return `Navigate to ${url}${reason ? ` — ${reason}` : ''}.`;
    }
    case 'open_tab': {
      const url = typeof args.url === 'string' ? args.url : 'a new tab';
      return `Open ${url} in a new tab${reason ? ` — ${reason}` : ''}.`;
    }
    case 'fill_login_credentials':
      return `Fill saved login credentials into the page${reason ? ` — ${reason}` : ''}.`;
    default:
      return `Run ${call.name}${reason ? ` — ${reason}` : ''}.`;
  }
}

function renderMarkdown(text: string): string {
  let html = normalizeAnswerText(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<em><strong>$1</strong></em>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/^\s*(\d+)\.\s+(.+)$/gm, '<li data-list="ol"><span class="answer-list-index">$1.</span> $2</li>');
  html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li data-list="ol">.*<\/li>\n?)+)/g, '<ol>$1</ol>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  html = html.replace(/ data-list="ol"/g, '');
  html = html.replace(/>\n</g, '><');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function normalizeAnswerText(text: string): string {
  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '  ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
