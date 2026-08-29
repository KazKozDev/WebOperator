import type { AgentTask } from '@/lib/types';

export function PlanPanel({ task, open, onToggle }: { task: AgentTask; open: boolean; onToggle: (open: boolean) => void }) {
  const plan = task.plan;
  const orchestration = task.orchestration;
  const lastTool = task.steps.slice().reverse().find((step) => step.toolCall)?.toolCall;
  if (!plan && !orchestration) return null;

  const done = plan?.steps.filter((step) => step.status === 'done').length ?? 0;
  const total = plan?.steps.length ?? 0;
  const active = plan?.steps.find((step) => step.status === 'active');

  return (
    <details className="plan-panel plan-collapse" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary className="plan-head">
        <span className="plan-title">Plan</span>
        {plan && <span className="plan-meta">{done}/{total} done</span>}
      </summary>
      <div className="plan-content">
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
        {orchestration && orchestration.managed && orchestration.subtasks.length > 0 && (
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
      </div>
    </details>
  );
}
