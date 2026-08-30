import type { AgentTask } from '@/lib/types';

export function PlanPanel({ task, open, onToggle }: { task: AgentTask; open: boolean; onToggle: (open: boolean) => void }) {
  const plan = task.plan;
  const orchestration = task.orchestration;
  const lastTool = task.steps.slice().reverse().find((step) => step.toolCall)?.toolCall;
  if (!plan && !orchestration) return null;

  const done = plan?.steps.filter((step) => step.status === 'done').length ?? 0;
  const total = plan?.steps.length ?? 0;
  const active = plan?.steps.find((step) => step.status === 'active');

  // Subtasks are a 1:1 mirror of the plan steps, so listing them separately would just
  // repeat the plan. Only their outcome (result / error) is information the plan lacks,
  // so it is folded into the matching plan step instead.
  const outcomeByIndex = new Map(
    (orchestration?.subtasks ?? [])
      .filter((subtask) => subtask.result || subtask.error)
      .map((subtask) => [subtask.index, subtask]),
  );

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
            {plan.steps.map((step) => {
              const outcome = outcomeByIndex.get(step.index);
              return (
                <li key={`${step.index}-${step.description}`} className={`plan-step ${step.status}`}>
                  <div className="plan-step-row">
                    <span className="plan-step-index">{step.index}</span>
                    <span className="plan-step-text">{step.description}</span>
                    <span className="plan-step-status">{step.status}</span>
                  </div>
                  {outcome?.error ? (
                    <div className="plan-step-note error">{outcome.error}</div>
                  ) : outcome?.result ? (
                    <div className="plan-step-note">{outcome.result}</div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </details>
  );
}
