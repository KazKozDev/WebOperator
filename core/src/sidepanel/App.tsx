import { useCallback, useEffect, useState } from 'react';

import type { AgentStep, AgentTask, CredentialSummary, CustomSkillDefinition, ScheduledTask, ScheduleRepeat, Settings, SWEvent } from '@/lib/types';

import { DEFAULT_SETTINGS, PROFILE_TO_MODEL, resolveOllamaModel } from '@/lib/types';
import { sendToSW } from '@/lib/messaging';
import { ping } from '@/lib/ollama-client';
import { formatTimings, latencyTarget } from '@/lib/benchmark';
import { buildTrace, downloadJson } from '@/lib/export';
import { BUILT_IN_SKILLS, getSkill, SKILL_META, type ClassifiedSkill } from '@/lib/skills';
import { useAgentPort } from './hooks/useAgentPort';
import { Icon } from './components/Icon';
import { PlanPanel } from './components/PlanPanel';
import { AnswerPanel } from './components/AnswerPanel';
import { ConfirmBox } from './components/ConfirmBox';
import { useVoiceInput } from './hooks/useVoiceInput';






type View = 'task' | 'history' | 'skills' | 'vault' | 'schedule' | 'settings';

const logoUrl = chrome.runtime.getURL('public/icons/icon48.png');

const CAPTCHA_TITLES: Record<NonNullable<AgentTask['pauseReason']>['challengeType'] & string, string> = {
  cloudflare: 'Human verification',
  recaptcha: 'reCAPTCHA verification',
  hcaptcha: 'hCaptcha verification',
  image: 'Image CAPTCHA',
  slider: 'Slider puzzle',
  audio: 'Audio CAPTCHA',
  unknown: 'Human verification / CAPTCHA',
};

export function App() {
  const [view, setView] = useState<View>('task');
  const [goal, setGoal] = useState('');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [task, setTask] = useState<AgentTask | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<{ ok: boolean; models: string[]; error?: string } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [detectedSkills, setDetectedSkills] = useState<ClassifiedSkill[]>([]);


  useEffect(() => {
    sendToSW<Settings>({ kind: 'settings:get' }).then(setSettings).catch(console.error);
  }, []);

  useEffect(() => {
    if (settings.provider !== 'ollama' || !settings.ollamaUrl) {
      setOllamaStatus(null);
      return;
    }
    const ctrl = new AbortController();
    ping(settings.ollamaUrl, ctrl.signal)
      .then(setOllamaStatus)
      .catch((err) => setOllamaStatus({ ok: false, models: [], error: err instanceof Error ? err.message : String(err) }));
    return () => ctrl.abort();
  }, [settings.ollamaUrl, settings.provider]);

  const handleEvent = useCallback((evt: SWEvent) => {
    if (evt.kind === 'task:update') {
      setTask({ ...evt.task });
      if (evt.task.status === 'running') {
        setView('task');
      }
    }
    if (evt.kind === 'task:step') setTask((t) => t && t.id === evt.taskId ? { ...t, steps: upsertStep(t.steps, evt.step) } : t);
    if (evt.kind === 'skills:detected') setDetectedSkills(evt.skills as ClassifiedSkill[]);
  }, []);


  useAgentPort(handleEvent);

  useEffect(() => {
    const handler = (msg: unknown) => {
      if (!msg || typeof msg !== 'object' || !('kind' in msg)) return;
      handleEvent(msg as SWEvent);
    };
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(handler);
      return () => {
        chrome.runtime.onMessage.removeListener(handler);
      };
    }
    return undefined;
  }, [handleEvent]);




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

  async function resumeCheckpoint(id?: string) {
    const targetId = id ?? task?.id;
    if (!targetId) return;
    setStartError(null);
    setIsStarting(true);
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (tab?.url) await requestTabAccess(tab.url);
      const resumed = await sendToSW<AgentTask>({ kind: 'task:resume_checkpoint', id: targetId });
      setTask(resumed);
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
          <button
            type="button"
            className="model-chip"
            style={{ cursor: 'pointer', background: 'transparent', border: 'none', padding: 0 }}
            onClick={() => setView('settings')}
            title={`Active: ${currentModelLabel(settings)} (click to open Settings)`}
          >
            {compactModelLabel(currentModelLabel(settings))}
          </button>
        </div>
      </header>

      <nav className="tab-nav" aria-label="Views">
        <button className={view === 'task' ? 'tab-item active' : 'tab-item'} onClick={() => setView('task')}>Task</button>
        <button className={view === 'history' ? 'tab-item active' : 'tab-item'} onClick={() => setView('history')}>History</button>
        <button className={view === 'schedule' ? 'tab-item active' : 'tab-item'} onClick={() => setView('schedule')}>Schedule</button>
        <button className={view === 'skills' ? 'tab-item active' : 'tab-item'} onClick={() => setView('skills')}>Skills</button>
        <button className={view === 'vault' ? 'tab-item active' : 'tab-item'} onClick={() => setView('vault')}>Vault</button>
        <button className={view === 'settings' ? 'tab-item active' : 'tab-item'} onClick={() => setView('settings')}>Settings</button>
      </nav>

      {settings.provider === 'ollama' && ollamaStatus && !ollamaStatus.ok && (
        <div className="banner err">
          Ollama unavailable ({ollamaStatus.error}). Run: <code>ollama serve</code> and <code>ollama pull {ollamaModelName(settings)}</code>.
        </div>
      )}
      {settings.provider === 'ollama' && ollamaStatus?.ok && !ollamaStatus.models.some((m) => m.startsWith(ollamaModelName(settings).split(':')[0])) && (
        <div className="banner warn">
          Model {ollamaModelName(settings)} is not installed. <code>ollama pull {ollamaModelName(settings)}</code>
        </div>
      )}
      {startError && (
        <div className="banner err">
          Failed to start: {startError}
        </div>
      )}

      {view === 'task' ? (
        <TaskView goal={goal} setGoal={setGoal} task={task} start={start} isStarting={isStarting} detectedSkills={detectedSkills} onResumeCheckpoint={resumeCheckpoint} />
      ) : view === 'history' ? (
        <HistoryView onReplay={(goal) => { setGoal(goal); start(goal); }} onOpen={(t) => { setTask(t); setView('task'); }} onResumeCheckpoint={resumeCheckpoint} />
      ) : view === 'schedule' ? (
        <ScheduleView onOpenTask={(t) => { setTask(t); setView('task'); }} />
      ) : view === 'skills' ? (
        <SkillsView settings={settings} updateSetting={updateSetting} />
      ) : view === 'vault' ? (
        <VaultView />
      ) : (
        <SettingsPanel settings={settings} updateSetting={updateSetting} />
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
    <section className="view active page-view schedule-view">
      <div className="page-note">Schedule tasks to run at a specific time or on a recurring interval.</div>


      <div className="ui-form schedule-form">
        <input value={name} placeholder="Task name" onChange={(e) => setName(e.target.value)} />
        <input value={startUrl} placeholder="Start URL" onChange={(e) => setStartUrl(e.target.value)} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <input type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} />
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as ScheduleRepeat)}>
            <option value="once">Repeat: Once</option>
            <option value="hourly">Repeat: Hourly</option>
            <option value="daily">Repeat: Daily</option>
            <option value="weekly">Repeat: Weekly</option>
          </select>
        </div>
        <textarea value={goal} placeholder="Goal" onChange={(e) => setGoal(e.target.value)} style={{ minHeight: '70px' }} />


        <div className="action-row controls">
          <button className="secondary" onClick={saveSchedule}>Save scheduled task</button>
          <button className="secondary" onClick={refreshSchedules}>Refresh</button>
        </div>
        {message && <div className="settings-note">{message}</div>}
      </div>


      <div className="ui-list schedule-list">

        {items.length === 0 ? (
          <div className="page-empty">No scheduled tasks yet.</div>
        ) : items.map((item) => (
          <div key={item.id} className="ui-list-item history-item">
            <div className="item-head step-head">
              <span className="item-meta step-detail">{item.lastStatus ?? (item.enabled ? 'enabled' : 'paused')}</span>
              <span className="status-pill">{item.enabled ? item.repeat : 'paused'}</span>
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

function TaskView({ goal, setGoal, task, start, isStarting, detectedSkills, onResumeCheckpoint }: {
  goal: string;
  setGoal: (g: string) => void;
  task: AgentTask | null;
  start: (text?: string) => void;
  isStarting: boolean;
  detectedSkills: ClassifiedSkill[];
  onResumeCheckpoint?: (id: string) => void;
}) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(true);
  const [planOpen, setPlanOpen] = useState(true);
  const running = isStarting || task?.status === 'running' || task?.status === 'planning';
  const paused = task?.status === 'paused';
  const awaitingConfirm = task?.status === 'awaiting_confirm';
  const selectedStep = task?.steps.find((s) => s.id === selectedStepId) ?? null;
  const finalAnswer = getTaskAnswer(task);
  const taskId = task?.id;
  const taskStatus = task?.status;

  const { isListening, toggleListening, error: voiceError } = useVoiceInput({
    onTranscript: (spokenText) => {
      setGoal(goal ? `${goal} ${spokenText}` : spokenText);
    },
  });


  useEffect(() => {
    if (!taskStatus) {
      setTraceOpen(true);
      setPlanOpen(true);
      return;
    }
    setTraceOpen(taskStatus === 'running' || taskStatus === 'planning' || taskStatus === 'awaiting_confirm');
    setPlanOpen(!(finalAnswer && (taskStatus === 'done' || taskStatus === 'failed')));
  }, [finalAnswer, taskId, taskStatus]);

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
            {task?.pauseReason?.kind === 'bot_challenge' && (
              <div className="challenge-handoff">
                <div className="challenge-handoff-header">
                  <span className="challenge-handoff-badge">Action required</span>
                  <span className="challenge-handoff-title">
                    {CAPTCHA_TITLES[task.pauseReason.challengeType ?? 'unknown']}
                  </span>
                </div>
                <p className="challenge-handoff-note">{task.pauseReason.note}</p>
                <div className="challenge-handoff-tab-info">
                  <span className="challenge-handoff-tab-title">{task.pauseReason.title || 'Challenge page'}</span>
                  <span className="challenge-handoff-url">{task.pauseReason.url}</span>
                </div>
                <div className="challenge-handoff-actions">
                  {typeof task.pauseReason.tabId === 'number' && (
                    <button
                      type="button"
                      className="secondary challenge-tab-btn"
                      onClick={() => chrome.tabs.update(task.pauseReason!.tabId!, { active: true })}
                    >
                      Show challenge tab
                    </button>
                  )}
                  <button
                    type="button"
                    className="primary challenge-resume-btn"
                    onClick={() => sendToSW({ kind: 'task:resume', id: task.id })}
                  >
                    I have solved it — Resume task
                  </button>
                </div>
              </div>
            )}
            <AnswerPanel answer={finalAnswer} task={task} isConfirmationCheckpoint={isConfirmationCheckpoint} onResumeCheckpoint={onResumeCheckpoint} />
            <PlanPanel task={task} open={planOpen} onToggle={setPlanOpen} />

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

      {task?.pauseReason?.kind === 'bot_challenge' && (
        <div className="challenge-sticky-banner">
          <div className="challenge-sticky-text">
            <strong>{CAPTCHA_TITLES[task.pauseReason.challengeType ?? 'unknown']}:</strong>{' '}
            Complete it in the tab; the task will resume automatically.
          </div>
          <button
            type="button"
            className="primary challenge-sticky-btn"
            onClick={() => sendToSW({ kind: 'task:resume', id: task.id })}
          >
            Resume task
          </button>
        </div>
      )}

      <div className="input-area">
        {voiceError && (
          <div style={{ color: 'var(--error, #ef4444)', fontSize: '11px', paddingBottom: '4px' }}>
            {voiceError}
          </div>
        )}
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
          <div className="composer-btns">
            <button
              type="button"
              className={`voice-btn ${isListening ? 'recording' : ''}`}
              title={isListening ? 'Listening... click to stop' : 'Voice input (dictate task)'}
              aria-label="Voice input"
              onClick={toggleListening}
              disabled={running}
            >
              <Icon name="mic" />
            </button>
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
        </div>
        <div className="composer-disclaimer">WebOperator can make mistakes. Please double-check responses.</div>

      </div>


      {selectedStep && (
        <StepDetails step={selectedStep} onClose={() => setSelectedStepId(null)} />
      )}
    </section>
  );
}

interface TaskDayGroup {
  key: string;
  label: string;
  isToday: boolean;
  tasks: AgentTask[];
}

function groupTasksByDay(tasks: AgentTask[]): TaskDayGroup[] {
  const groups = new Map<string, TaskDayGroup>();
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const yesterday = new Date(now.getTime() - 86400000);
  const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  for (const task of tasks) {
    const d = new Date(task.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const formattedDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    let label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    let isToday = false;
    if (key === todayKey) {
      label = `Today, ${formattedDate}`;
      isToday = true;
    } else if (key === yesterdayKey) {
      label = `Yesterday, ${formattedDate}`;
    }


    if (!groups.has(key)) {
      groups.set(key, { key, label, isToday, tasks: [] });
    }
    groups.get(key)!.tasks.push(task);
  }
  return Array.from(groups.values());
}


function HistoryView({ onReplay, onOpen, onResumeCheckpoint }: { onReplay: (goal: string) => void; onOpen: (t: AgentTask) => void; onResumeCheckpoint?: (id: string) => void }) {

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

  const dayGroups = groupTasksByDay(tasks);

  return (
    <section className="view active page-view history-view">
      <div className="page-note">Review completed task traces, inspect execution logs, or replay previous goals.</div>

      <div className="history-accordion">
        {dayGroups.map((group) => (
          <details key={group.key} className="history-day-group" open={group.isToday || dayGroups.length === 1}>
            <summary className="history-day-summary">
              <span className="history-day-label">{group.label}</span>
              <span className="history-day-count">{group.tasks.length} {group.tasks.length === 1 ? 'task' : 'tasks'}</span>
            </summary>
            <div className="ui-list history-list">
              {group.tasks.map((t) => (

                <div key={t.id} className="ui-list-item history-item">
                  <div className="item-title history-goal">{t.goal}</div>

                  <div className="action-row controls">
                    <button className="secondary" onClick={() => openTask(t.id)}>Open</button>
                    {t.status === 'failed' && onResumeCheckpoint && (
                      <button className="secondary" onClick={() => onResumeCheckpoint(t.id)}>Resume</button>
                    )}
                    <button className="secondary" onClick={() => onReplay(t.goal)}>Repeat</button>

                    <button className="secondary" onClick={() => exportTask(t.id)}>Export</button>
                    <div className="history-meta">
                      <span className="item-meta step-detail">{new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className={`status-pill status-${t.status}`} title={t.status}>
                        {t.status === 'done' ? '✓' : t.status === 'failed' ? '✕' : t.status}
                      </span>

                    </div>
                  </div>

                </div>


              ))}
            </div>
          </details>
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
  const [customSkills, setCustomSkills] = useState<CustomSkillDefinition[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [domainPattern, setDomainPattern] = useState('');
  const [keywords, setKeywords] = useState('');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadCustomSkills = useCallback(async () => {
    try {
      const list = await sendToSW<CustomSkillDefinition[]>({ kind: 'custom_skill:list' });
      setCustomSkills(list);
    } catch {}
  }, []);

  useEffect(() => {
    void loadCustomSkills();
  }, [loadCustomSkills]);

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

  async function handleSaveCustomSkill(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Skill name is required'); return; }
    if (!prompt.trim()) { setError('Skill instructions/prompt are required'); return; }

    const kwArray = keywords
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const domainsArray = domainPattern
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      await sendToSW({
        kind: 'custom_skill:save',
        skill: {
          name: name.trim(),
          summary: summary.trim() || name.trim(),
          domains: domainsArray.length ? domainsArray : ['*'],
          keywords: kwArray.length ? kwArray : [name.trim().toLowerCase()],
          prompt: prompt.trim(),
          risk: 'safe',
          enabled: true,
        },
      });

      setName('');
      setSummary('');
      setDomainPattern('');
      setKeywords('');
      setPrompt('');
      setIsCreating(false);
      await loadCustomSkills();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteCustomSkill(id: string) {
    try {
      await sendToSW({ kind: 'custom_skill:delete', id });
      await loadCustomSkills();
    } catch {}
  }

  return (
    <section className="view active page-view skills-view">
      <div className="page-note">Reusable domain playbooks. Enabled skills guide the agent's actions when relevant sites or tasks are matched.</div>


      <div className="section-header">
        <h4 className="section-title">Built-in Skills</h4>
      </div>

      <div className="ui-list skills-list">
        {BUILT_IN_SKILLS.map((skill) => {
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
        })}
      </div>

      <div className="section-header" style={{ marginTop: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="section-title">Custom Skills</span>
          <span className="status-pill" style={{ padding: '2px 6px', fontSize: '10px' }}>{customSkills.length}</span>
        </div>
        <button
          type="button"
          className="secondary"
          style={{ fontSize: '11px', padding: '3px 8px', fontWeight: 500 }}
          onClick={() => setIsCreating((prev) => !prev)}
        >
          {isCreating ? 'Cancel' : '+ Add custom skill'}
        </button>
      </div>

      {isCreating && (
        <form onSubmit={handleSaveCustomSkill} className="ui-form custom-skill-form" style={{ marginTop: '12px' }}>
          {error && <div className="banner err" style={{ margin: '0 0 10px 0' }}>{error}</div>}

          <input
            placeholder="Skill Name *"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            placeholder="Summary / Short Description"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
          <input
            placeholder="Target Domains (comma separated)"
            value={domainPattern}
            onChange={(e) => setDomainPattern(e.target.value)}
          />
          <input
            placeholder="Trigger Keywords (comma separated)"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
          />
          <textarea
            style={{ minHeight: '80px', fontFamily: 'var(--font-mono)' }}
            placeholder="Agent Instructions / Prompt *"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />

          <div className="action-row controls" style={{ justifyContent: 'flex-end', marginTop: '6px' }}>
            <button type="button" className="secondary" onClick={() => setIsCreating(false)}>Cancel</button>
            <button type="submit" className="primary">Save Skill</button>
          </div>
        </form>
      )}


      {customSkills.length > 0 && (
        <div className="ui-list skills-list" style={{ marginTop: '8px' }}>
          {customSkills.map((skill) => {
            const open = expanded.has(skill.id);
            return (
              <article key={skill.id} className="ui-list-item skill-card active">
                <div className="skill-row" onClick={() => toggleExpand(skill.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="item-title skill-title">{skill.name}</span>
                    <span className="status-pill" style={{ padding: '1px 5px', fontSize: '9px' }}>Custom</span>
                  </div>
                  <button
                    type="button"
                    style={{ background: 'transparent', border: 'none', color: 'var(--error, #ef4444)', fontSize: '11px', cursor: 'pointer' }}
                    onClick={(e) => { e.stopPropagation(); void handleDeleteCustomSkill(skill.id); }}
                    title="Delete custom skill"
                  >
                    Delete
                  </button>
                </div>
                {open && (
                  <div className="skill-detail" style={{ marginTop: '8px' }}>
                    <p className="item-meta skill-desc" style={{ marginBottom: '4px' }}>{skill.summary}</p>
                    {skill.domains.length > 0 && <div style={{ fontSize: '11px', color: 'var(--text2)', marginBottom: '2px' }}>Domains: {skill.domains.join(', ')}</div>}
                    {skill.keywords.length > 0 && <div style={{ fontSize: '11px', color: 'var(--text2)', marginBottom: '4px' }}>Keywords: {skill.keywords.join(', ')}</div>}
                    <pre style={{ background: 'rgba(0,0,0,0.2)', padding: '6px', borderRadius: '4px', fontSize: '10px', whiteSpace: 'pre-wrap' }}>{skill.prompt}</pre>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

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
      setMessage('Saved securely to Vault.');
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
      <div className="page-note">Secure local credential storage. Passwords are saved safely in your encrypted extension environment for automated logins.</div>
      <div className="ui-form settings">
        <input value={origin} placeholder="Site origin (e.g. https://example.com)" onChange={(e) => setOrigin(e.target.value)} />
        <input value={username} placeholder="Username / email" autoComplete="username" onChange={(e) => setUsername(e.target.value)} />
        <input type="password" value={password} placeholder="Password" autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
        <input value={label} placeholder="Label (optional)" onChange={(e) => setLabel(e.target.value)} />
        <div className="action-row controls">
          <button className="secondary" onClick={save}>Save credential</button>
          <button className="secondary" onClick={clear} disabled={entries.length === 0}>Clear vault</button>
        </div>
        {message && <div className="settings-note">{message}</div>}
      </div>



      <div className="ui-list history-list">
        {entries.length === 0 ? (
          <div className="page-empty">No credentials saved in Vault.</div>
        ) : entries.map((entry) => (
          <div key={entry.id} className="ui-list-item history-item">
            <div className="item-head step-head">
              <span className="item-meta step-detail">{new Date(entry.updatedAt).toLocaleString()}</span>
              <span className="status-pill">{entry.label || 'Credential'}</span>
            </div>
            <div className="item-title history-goal">{entry.origin}</div>

            <div className="item-meta step-detail">{entry.username} · stored securely</div>
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
      <div className="page-note">Configure AI model providers, API credentials, vision modes, and browser execution policies.</div>
      <div className="ui-form settings">

      <select value={settings.provider} onChange={(e) => updateSetting('provider', e.target.value as Settings['provider'])}>

        <option value="anthropic">Provider: Anthropic (Claude)</option>
        <option value="deepseek">Provider: DeepSeek</option>
        <option value="gemini">Provider: Google Gemini</option>
        <option value="mlx">Provider: MLX (Local)</option>
        <option value="ollama">Provider: Ollama (Local)</option>
        <option value="openai">Provider: OpenAI</option>
        <option value="openrouter">Provider: OpenRouter</option>
        <option value="siliconflow">Provider: SiliconFlow</option>
        <option value="xai">Provider: xAI</option>
      </select>


      {settings.provider === 'anthropic' && (
        <>
          <input type="password" value={settings.anthropicApiKey} onChange={(e) => updateSetting('anthropicApiKey', e.target.value)} placeholder="Anthropic API Key" />
          <input value={settings.anthropicModel} onChange={(e) => updateSetting('anthropicModel', e.target.value)} placeholder="Claude Model (e.g. claude-3-7-sonnet-20250219)" />
        </>
      )}


      {settings.provider === 'ollama' && (
        <>
          <input value={settings.ollamaUrl} onChange={(e) => updateSetting('ollamaUrl', e.target.value)} placeholder="Ollama URL (e.g. http://127.0.0.1:11434)" />
          <input
            value={settings.ollamaModel}
            onChange={(e) => updateSetting('ollamaModel', e.target.value)}
            placeholder="Ollama Model (e.g. qwen2.5-vl:7b)"
          />
        </>
      )}


      {settings.provider === 'openai' && (
        <>
          <input type="password" value={settings.openaiApiKey} onChange={(e) => updateSetting('openaiApiKey', e.target.value)} placeholder="OpenAI API Key" />
          <input value={settings.openaiModel} onChange={(e) => updateSetting('openaiModel', e.target.value)} placeholder="OpenAI Model (e.g. gpt-5-mini)" />
        </>
      )}

      {settings.provider === 'gemini' && (
        <>
          <input type="password" value={settings.geminiApiKey} onChange={(e) => updateSetting('geminiApiKey', e.target.value)} placeholder="Gemini API Key" />
          <input value={settings.geminiModel} onChange={(e) => updateSetting('geminiModel', e.target.value)} placeholder="Gemini Model (e.g. gemini-2.5-flash)" />
        </>
      )}

      {settings.provider === 'gemini' && (
        <>
          <label>
            Gemini API Key
            <input type="password" value={settings.geminiApiKey} onChange={(e) => updateSetting('geminiApiKey', e.target.value)} placeholder="AI..." />
          </label>
          <label>
            Gemini Model
            <input value={settings.geminiModel} onChange={(e) => updateSetting('geminiModel', e.target.value)} placeholder="e.g. gemini-2.5-flash" />
          </label>
          <div className="settings-note">
            Get a key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>. Uses Gemini's OpenAI-compatible chat completions endpoint.
          </div>
        </>
      )}

      {settings.provider === 'xai' && (
        <>
          <input type="password" value={settings.xaiApiKey} onChange={(e) => updateSetting('xaiApiKey', e.target.value)} placeholder="xAI API Key" />
          <input value={settings.xaiModel} onChange={(e) => updateSetting('xaiModel', e.target.value)} placeholder="xAI Model (e.g. grok-4-1-fast-non-reasoning)" />
        </>
      )}

      {settings.provider === 'openrouter' && (
        <>
          <input type="password" value={settings.openRouterApiKey} onChange={(e) => updateSetting('openRouterApiKey', e.target.value)} placeholder="OpenRouter API Key" />
          <input value={settings.openRouterModel} onChange={(e) => updateSetting('openRouterModel', e.target.value)} placeholder="OpenRouter Model (e.g. google/gemma-4-31b-it)" />
        </>
      )}

      {settings.provider === 'deepseek' && (
        <>
          <input type="password" value={settings.deepseekApiKey} onChange={(e) => updateSetting('deepseekApiKey', e.target.value)} placeholder="DeepSeek API Key" />
          <input value={settings.deepseekModel} onChange={(e) => updateSetting('deepseekModel', e.target.value)} placeholder="DeepSeek Model (e.g. deepseek-v4-flash)" />
        </>
      )}

      {settings.provider === 'siliconflow' && (
        <>
          <label>
            SiliconFlow API Key
            <input type="password" value={settings.siliconFlowApiKey} onChange={(e) => updateSetting('siliconFlowApiKey', e.target.value)} placeholder="sk-..." />
          </label>
          <label>
            SiliconFlow Model
            <input value={settings.siliconFlowModel} onChange={(e) => updateSetting('siliconFlowModel', e.target.value)} placeholder="e.g. Qwen/Qwen2.5-VL-72B-Instruct" />
          </label>
          <div className="settings-note">
            Get a key at <a href="https://cloud.siliconflow.com/account/ak" target="_blank" rel="noreferrer">cloud.siliconflow.com</a>. Model must support vision + function calling.
          </div>
        </>
      )}

      {settings.provider === 'mlx' && (
        <>
          <input type="password" value={settings.mlxApiKey} onChange={(e) => updateSetting('mlxApiKey', e.target.value)} placeholder="MLX API Key (optional)" />
          <input value={settings.mlxModel} onChange={(e) => updateSetting('mlxModel', e.target.value)} placeholder="MLX Model (e.g. mlx-community/Qwen2.5-VL-7B-Instruct-4bit)" />
        </>
      )}

      <details className="settings-advanced">
        <summary>Advanced Settings</summary>
        <div className="settings-advanced-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <select value={settings.screenshotPolicy} onChange={(e) => updateSetting('screenshotPolicy', e.target.value as Settings['screenshotPolicy'])}>
              <option value="auto">Vision: Auto</option>
              <option value="always">Vision: Always</option>
              <option value="never">Vision: Never</option>
            </select>
            <input type="number" value={settings.actionTimeoutMs} onChange={(e) => updateSetting('actionTimeoutMs', Number(e.target.value))} placeholder="Timeout, ms" />
          </div>
          <select value={settings.thinkingPolicy} onChange={(e) => updateSetting('thinkingPolicy', e.target.value as Settings['thinkingPolicy'])}>
            <option value="auto">Thinking: Auto</option>
            <option value="always">Thinking: Always</option>
            <option value="never">Thinking: Never</option>
          </select>

          <select value={settings.contextCompressor} onChange={(e) => updateSetting('contextCompressor', e.target.value as Settings['contextCompressor'])}>
            <option value="off">Context compressor: Off (deterministic)</option>
            <option value="same">Context compressor: Same model</option>
            <option value="cloud">Context compressor: Cloud (DeepSeek/Gemini)</option>
          </select>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <select value={settings.visualTokenBudget} onChange={(e) => updateSetting('visualTokenBudget', Number(e.target.value) as Settings['visualTokenBudget'])}>
              {[70, 140, 280, 560, 1120].map((n) => <option key={n} value={n}>Vision: {n} tokens</option>)}
            </select>
            <select value={settings.visualTokenBudgetVerify} onChange={(e) => updateSetting('visualTokenBudgetVerify', Number(e.target.value) as Settings['visualTokenBudgetVerify'])}>
              {[70, 140, 280, 560, 1120].map((n) => <option key={n} value={n}>Verify: {n} tokens</option>)}
            </select>
          </div>
          <input
            value={settings.whitelist.join(', ')}
            placeholder="Domain whitelist (e.g. example.com, *.mysite.org)"
            onChange={(e) => updateSetting('whitelist', splitList(e.target.value))}
          />
          <input
            value={settings.blacklist.join(', ')}
            placeholder="Domain blacklist (e.g. bank.com, *.paypal.com)"
            onChange={(e) => updateSetting('blacklist', splitList(e.target.value))}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 2px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text2)' }}>Action cache</span>
            <input
              type="checkbox"
              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              checked={settings.useActionCache}
              onChange={(e) => updateSetting('useActionCache', e.target.checked)}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 2px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text2)' }}>Reload page before task</span>
            <input
              type="checkbox"
              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              checked={settings.resetPageOnStart}
              onChange={(e) => updateSetting('resetPageOnStart', e.target.checked)}
            />
          </div>
          <input
            type="number"
            min={1}
            max={365}
            value={settings.cacheTtlDays}
            placeholder="Cache TTL, days"
            onChange={(e) => updateSetting('cacheTtlDays', Number(e.target.value))}
          />
          <div className="action-row controls" style={{ marginTop: '4px' }}>
            <button className="secondary" onClick={async () => {
              const res = await sendToSW<{ ok: boolean; removed: number }>({ kind: 'cache:clear' });
              alert(`Removed entries: ${res.removed}`);
            }}>Clear action cache</button>
          </div>
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
  if (settings.provider === 'anthropic') return settings.anthropicModel || 'Claude 3.7 Sonnet';
  if (settings.provider === 'openai') return settings.openaiModel;
  if (settings.provider === 'gemini') return settings.geminiModel;
  if (settings.provider === 'xai') return settings.xaiModel;
  if (settings.provider === 'openrouter') return settings.openRouterModel;
  if (settings.provider === 'siliconflow') return settings.siliconFlowModel;
  if (settings.provider === 'mlx') return settings.mlxModel;
  if (settings.provider === 'deepseek') return settings.deepseekModel;
  return ollamaModelName(settings);
}

function ollamaModelName(settings: Settings): string {
  return resolveOllamaModel(settings.ollamaModel, PROFILE_TO_MODEL[settings.profile]);
}

function compactModelLabel(value: string): string {
  const cleaned = value
    .replace(/^google\//, '')
    .replace(/^gemini /i, 'Gemini ')
    .replace(/^mlx-community\//, '')
    .replace(/-/g, ' ')
    .replace(/\bnon reasoning\b/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^claude/i.test(cleaned)) return 'Claude 3.7';
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

export { renderMarkdown } from './utils/markdown';

