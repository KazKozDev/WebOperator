/**
 * Typed Finite State Machine for Agent Task Lifecycle.
 * Implements deterministic state transitions and state change listeners.
 */

export type AgentState =
  | 'IDLE'
  | 'PLANNING'
  | 'OBSERVING'
  | 'STREAMING'
  | 'EXECUTING'
  | 'WAITING_CONFIRM'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED';

export interface StateTransitionEvent {
  from: AgentState;
  to: AgentState;
  taskId: string;
  timestamp: number;
  reason?: string;
}

export type StateListener = (event: StateTransitionEvent) => void;

export class AgentFSM {
  private currentState: AgentState = 'IDLE';
  private listeners = new Set<StateListener>();

  constructor(private taskId: string, initialState: AgentState = 'IDLE') {
    this.currentState = initialState;
  }

  public get state(): AgentState {
    return this.currentState;
  }

  public canTransitionTo(next: AgentState): boolean {
    if (this.currentState === next) return true;

    switch (this.currentState) {
      case 'IDLE':
        return next === 'PLANNING' || next === 'OBSERVING';
      case 'PLANNING':
        return next === 'STREAMING' || next === 'EXECUTING' || next === 'FAILED' || next === 'PAUSED';
      case 'OBSERVING':
        return next === 'STREAMING' || next === 'EXECUTING' || next === 'FAILED' || next === 'PAUSED';
      case 'STREAMING':
        return next === 'EXECUTING' || next === 'WAITING_CONFIRM' || next === 'COMPLETED' || next === 'FAILED' || next === 'PAUSED';
      case 'EXECUTING':
        return next === 'OBSERVING' || next === 'COMPLETED' || next === 'FAILED' || next === 'PAUSED';
      case 'WAITING_CONFIRM':
        return next === 'EXECUTING' || next === 'FAILED' || next === 'PAUSED';
      case 'PAUSED':
        return next === 'OBSERVING' || next === 'STREAMING' || next === 'EXECUTING' || next === 'FAILED';
      case 'COMPLETED':
      case 'FAILED':
        return next === 'IDLE' || next === 'PLANNING';
      default:
        return false;
    }
  }

  public transition(next: AgentState, reason?: string): boolean {
    if (!this.canTransitionTo(next)) {
      console.warn(`[AgentFSM] Invalid transition from ${this.currentState} to ${next} for task ${this.taskId}`);
      return false;
    }

    const event: StateTransitionEvent = {
      from: this.currentState,
      to: next,
      taskId: this.taskId,
      timestamp: Date.now(),
      reason,
    };

    this.currentState = next;

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[AgentFSM] Error in state listener', err);
      }
    }

    return true;
  }

  public onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
