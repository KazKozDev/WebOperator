import { describe, expect, it, vi } from 'vitest';
import { AgentFSM } from './fsm';

describe('AgentFSM', () => {
  it('initializes in IDLE state', () => {
    const fsm = new AgentFSM('task-1');
    expect(fsm.state).toBe('IDLE');
  });

  it('allows valid state transitions', () => {
    const fsm = new AgentFSM('task-1');
    expect(fsm.transition('PLANNING')).toBe(true);
    expect(fsm.state).toBe('PLANNING');
    expect(fsm.transition('STREAMING')).toBe(true);
    expect(fsm.state).toBe('STREAMING');
    expect(fsm.transition('EXECUTING')).toBe(true);
    expect(fsm.state).toBe('EXECUTING');
    expect(fsm.transition('COMPLETED')).toBe(true);
    expect(fsm.state).toBe('COMPLETED');
  });

  it('blocks invalid transitions and returns false', () => {
    const fsm = new AgentFSM('task-1');
    expect(fsm.transition('COMPLETED')).toBe(false);
    expect(fsm.state).toBe('IDLE');
  });

  it('notifies listeners on transition', () => {
    const fsm = new AgentFSM('task-1');
    const listener = vi.fn();
    fsm.onStateChange(listener);

    fsm.transition('PLANNING', 'user started task');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      from: 'IDLE',
      to: 'PLANNING',
      taskId: 'task-1',
      reason: 'user started task',
    }));
  });
});
