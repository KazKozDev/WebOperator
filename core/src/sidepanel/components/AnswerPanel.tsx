import { useState } from 'react';
import type { AgentTask } from '@/lib/types';
import { renderMarkdown } from '../utils/markdown';

export function AnswerPanel({
  answer,
  task,
  isConfirmationCheckpoint,
  onResumeCheckpoint,
  onExport,
}: {
  answer: string | null;
  task: AgentTask;
  isConfirmationCheckpoint: (task: AgentTask | null) => boolean;
  onResumeCheckpoint?: (taskId: string) => void;
  onExport?: () => void | Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [exportState, setExportState] = useState<'idle' | 'exporting' | 'done' | 'error'>('idle');
  const isFinished = task.status === 'done' || task.status === 'failed';
  const isFailed = task.status === 'failed';
  const needsConfirmation = isConfirmationCheckpoint(task);
  const tone = needsConfirmation ? 'confirm' : isFailed ? 'failure' : task.status === 'done' ? 'success' : 'pending';
  const fallback = isFailed
    ? (task.error ? `Error: ${task.error}` : 'Task stopped before producing a final answer.')
    : 'Waiting for the final answer...';

  const textToCopy = answer ?? (isFailed ? fallback : '');

  const headerBtnStyle = { fontSize: '11px', color: 'var(--text2)', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' } as const;

  const copyAnswer = async () => {
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const exportPdf = async () => {
    if (!onExport || exportState === 'exporting') return;
    setExportState('exporting');
    try {
      await onExport();
      setExportState('done');
      setTimeout(() => setExportState('idle'), 2000);
    } catch (error) {
      console.error('PDF export failed', error);
      setExportState('error');
      setTimeout(() => setExportState('idle'), 3000);
    }
  };

  return (
    <section className={`answer-panel ${tone}`}>
      <div className="answer-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="answer-label">{needsConfirmation ? 'Needs confirmation' : isFinished ? (isFailed ? 'Stopped with issue' : 'Answer') : 'Answer pending'}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {textToCopy && (
            <button
              type="button"
              className="icon-btn-text"
              style={headerBtnStyle}
              onClick={copyAnswer}
              title="Copy answer"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          )}
          {onExport && (
            <button
              type="button"
              className="icon-btn-text"
              style={headerBtnStyle}
              onClick={exportPdf}
              title="Save task report as PDF"
              disabled={exportState === 'exporting'}
            >
              {exportState === 'exporting' ? 'Saving…' : exportState === 'done' ? '✓ Saved' : exportState === 'error' ? 'Export failed' : 'Export PDF'}
            </button>
          )}
        </div>
      </div>
      <div className="answer-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(answer ?? fallback) }} />
      {isFailed && onResumeCheckpoint && (
        <div className="answer-actions" style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-start' }}>
          <button
            type="button"
            className="secondary"
            style={{ fontSize: '11px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            onClick={() => onResumeCheckpoint(task.id)}
            title="Resume from last successful step"
          >
            <span>↻</span> Resume from step
          </button>
        </div>
      )}
    </section>
  );
}

