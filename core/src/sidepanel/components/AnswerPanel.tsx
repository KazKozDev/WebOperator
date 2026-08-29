import { useState } from 'react';
import type { AgentTask } from '@/lib/types';
import { renderMarkdown } from '../utils/markdown';

export function AnswerPanel({
  answer,
  task,
  isConfirmationCheckpoint,
  onResumeCheckpoint,
}: {
  answer: string | null;
  task: AgentTask;
  isConfirmationCheckpoint: (task: AgentTask | null) => boolean;
  onResumeCheckpoint?: (taskId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const isFinished = task.status === 'done' || task.status === 'failed';
  const isFailed = task.status === 'failed';
  const needsConfirmation = isConfirmationCheckpoint(task);
  const tone = needsConfirmation ? 'confirm' : isFailed ? 'failure' : task.status === 'done' ? 'success' : 'pending';
  const fallback = isFailed
    ? (task.error ? `Error: ${task.error}` : 'Task stopped before producing a final answer.')
    : 'Waiting for the final answer...';

  const textToCopy = answer ?? (isFailed ? fallback : '');

  const copyAnswer = async () => {
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <section className={`answer-panel ${tone}`}>
      <div className="answer-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="answer-label">{needsConfirmation ? 'Needs confirmation' : isFinished ? (isFailed ? 'Stopped with issue' : 'Answer') : 'Answer pending'}</div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {isFailed && onResumeCheckpoint && (
            <button
              type="button"
              className="icon-btn-text"
              style={{ fontSize: '11px', color: 'var(--primary, #3b82f6)', background: 'transparent', border: '1px solid currentColor', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer' }}
              onClick={() => onResumeCheckpoint(task.id)}
              title="Resume from last successful step"
            >
              ↻ Resume from step
            </button>
          )}
          {textToCopy && (
            <button
              type="button"
              className="icon-btn-text"
              style={{ fontSize: '11px', color: 'var(--text2)', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
              onClick={copyAnswer}
              title="Copy answer"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          )}
        </div>
      </div>
      <div className="answer-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(answer ?? fallback) }} />
    </section>
  );
}

