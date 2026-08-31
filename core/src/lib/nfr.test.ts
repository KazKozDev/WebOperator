import { describe, expect, it } from 'vitest';
import { latencyTarget, summarize } from './benchmark';
import { buildTrace } from './export';
import { maskCallForLog, maskTaskForLog } from './masking';
import { shouldAttachScreenshot, isDomainAllowed } from './vision-policy';
import { DEFAULT_SETTINGS, type A11ySnapshot, type AgentStep, type AgentTask, type ToolCall } from './types';
import { TOOL_NAMES } from './tools';

function snapshot(overrides: Partial<A11ySnapshot> = {}): A11ySnapshot {
  return {
    url: 'https://example.com/login',
    title: 'Login',
    viewport: { w: 1280, h: 720, scrollX: 0, scrollY: 0 },
    domHash: 'dom-1',
    takenAt: 1,
    nodes: [
      {
        ref: '@e1',
        role: 'textbox',
        name: 'Password',
        value: '••••••',
        bbox: { x: 10, y: 20, w: 200, h: 32 },
        inViewport: true,
      },
    ],
    ...overrides,
  };
}

function step(overrides: Partial<AgentStep> = {}): AgentStep {
  return {
    id: 'task-1-0',
    index: 0,
    status: 'ok',
    startedAt: 1,
    timings: { totalMs: 1_000 },
    ...overrides,
  };
}

function task(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'task-1',
    goal: 'log in',
    tabId: 1,
    status: 'done',
    createdAt: 1,
    updatedAt: 2,
    profile: 'balanced',
    steps: [],
    ...overrides,
  };
}

describe('privacy masking', () => {
  it('masks type tool calls targeting password-like fields', () => {
    const call: ToolCall = { name: 'type', arguments: { ref: '@e1', text: 'secret123' } };

    expect(maskCallForLog(call, snapshot()).arguments.text).toBe('••••••');
  });

  it('leaves non-password type tool calls intact', () => {
    const call: ToolCall = { name: 'type', arguments: { ref: '@e2', text: 'hello' } };
    const plain = snapshot({
      nodes: [
        {
          ref: '@e2',
          role: 'textbox',
          name: 'Search',
          bbox: { x: 10, y: 20, w: 200, h: 32 },
          inViewport: true,
        },
      ],
    });

    expect(maskCallForLog(call, plain)).toBe(call);
  });

  it('masks password text nested inside batch_actions', () => {
    const call: ToolCall = {
      name: 'batch_actions',
      arguments: { actions: [
        { name: 'type', ref: '@e1', text: 'secret123' },
        { name: 'press', key: 'Tab' },
      ] },
    };

    const masked = maskCallForLog(call, snapshot());
    expect(masked.arguments.actions).toEqual([
      { name: 'type', ref: '@e1', text: '••••••' },
      { name: 'press', key: 'Tab' },
    ]);
  });

  it('masks task steps before log/export use', () => {
    const sensitive = task({
      steps: [
        step({
          snapshot: snapshot(),
          toolCall: { name: 'type', arguments: { ref: '@e1', text: 'secret123' } },
        }),
      ],
    });

    const masked = maskTaskForLog(sensitive);

    expect(masked.steps[0].toolCall?.arguments.text).toBe('••••••');
    expect(sensitive.steps[0].toolCall?.arguments.text).toBe('secret123');
  });
});

describe('trace export', () => {
  it('exports masked task data', () => {
    const trace = buildTrace(task({
      steps: [
        step({
          snapshot: snapshot(),
          toolCall: { name: 'type', arguments: { ref: '@e1', text: 'secret123' } },
        }),
      ],
    }));

    expect(trace.version).toBe(1);
    expect(trace.task.steps[0].toolCall?.arguments.text).toBe('••••••');
  });
});

describe('latency benchmark', () => {
  it('uses profile-specific planning budgets', () => {
    const target = latencyTarget(step({ index: 0, timings: { totalMs: 11_000 } }), 'fast');

    expect(target.label).toBe('planning');
    expect(target.budgetMs).toBe(10_500);
    expect(target.exceeds).toBe(true);
  });

  it('summarizes p50, p95, and exceed rate', () => {
    const summary = summarize([
      step({ id: 's1', index: 1, timings: { totalMs: 100 } }),
      step({ id: 's2', index: 1, timings: { totalMs: 2_100 } }),
      step({ id: 's3', index: 1, timings: { totalMs: 3_000 } }),
    ], 'balanced');

    expect(summary.p50).toBe(2_100);
    expect(summary.p95).toBe(3_000);
    expect(summary.exceedRate).toBeCloseTo(2 / 3);
  });
});

describe('vision policy and domain gates', () => {
  it('attaches screenshots for empty accessibility snapshots in auto mode', () => {
    const decision = shouldAttachScreenshot(
      snapshot({ nodes: [] }),
      DEFAULT_SETTINGS,
      { stepIndex: 1 },
    );

    expect(decision.attach).toBe(true);
    expect(decision.visualTokens).toBe(DEFAULT_SETTINGS.visualTokenBudgetVerify);
    expect(decision.isVerification).toBe(true);
  });

  it('respects never screenshot policy', () => {
    const decision = shouldAttachScreenshot(
      snapshot({ nodes: [] }),
      { ...DEFAULT_SETTINGS, screenshotPolicy: 'never' },
      { stepIndex: 1 },
    );

    expect(decision.attach).toBe(false);
  });

  it('enforces blacklist before whitelist success', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      whitelist: ['example.com'],
      blacklist: ['secure.example.com'],
    };

    expect(isDomainAllowed('https://secure.example.com/pay', settings).allowed).toBe(false);
    expect(isDomainAllowed('https://www.example.com/page', settings).allowed).toBe(true);
    expect(isDomainAllowed('https://other.test/page', settings).allowed).toBe(false);
  });
});

describe('tool schema coverage', () => {
  it('exposes multi-tab tools to the model', () => {
    expect(TOOL_NAMES).toContain('open_tab');
    expect(TOOL_NAMES).toContain('switch_tab');
  });
});
