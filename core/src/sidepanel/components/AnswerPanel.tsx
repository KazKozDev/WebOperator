import { useState } from 'react';
import type { AgentTask } from '@/lib/types';
import { renderMarkdown } from '../utils/markdown';

export function AnswerPanel({
  answer,
  task,
  isConfirmationCheckpoint,
  onResumeCheckpoint,
  onExport,
  onAsk,
}: {
  answer: string | null;
  task: AgentTask;
  isConfirmationCheckpoint: (task: AgentTask | null) => boolean;
  onResumeCheckpoint?: (taskId: string) => void;
  onExport?: () => void | Promise<void>;
  onAsk?: (taskId: string, question: string) => Promise<string>;
}) {
  const [copied, setCopied] = useState(false);
  const [exportState, setExportState] = useState<'idle' | 'exporting' | 'done' | 'error'>('idle');
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [qa, setQa] = useState<{ question: string; answer: string }[]>([]);
  const [askError, setAskError] = useState<string | null>(null);
  const isStopped = task.status === 'stopped';
  const isFinished = task.status === 'done' || task.status === 'failed' || isStopped;
  const isFailed = task.status === 'failed';
  const needsConfirmation = isConfirmationCheckpoint(task);
  const tone = needsConfirmation ? 'confirm' : isFailed ? 'failure' : task.status === 'done' ? 'success' : 'pending';
  const fallback = isFailed
    ? (task.error ? `Error: ${task.error}` : 'Task stopped before producing a final answer.')
    : isStopped
      ? 'Stopped. Summarizing what was collected...'
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
        <div className="answer-label">{needsConfirmation ? 'Needs confirmation' : isStopped ? 'Stopped — partial result' : isFinished ? (isFailed ? 'Stopped with issue' : 'Answer') : 'Answer pending'}</div>
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
      {(isFailed || isStopped) && onResumeCheckpoint && (
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

      {isFinished && onAsk && (
        <div className="answer-followup" style={{ marginTop: '12px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
          {qa.map((entry, i) => (
            <div key={i} style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text2)', marginBottom: '3px' }}>{entry.question}</div>
              <div className="answer-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.answer) }} />
            </div>
          ))}
          {askError && <div style={{ fontSize: '11px', color: 'var(--danger, #c66)', marginBottom: '6px' }}>{askError}</div>}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const q = question.trim();
              if (!q || asking) return;
              setAsking(true);
              setAskError(null);
              try {
                const reply = await onAsk(task.id, q);
                setQa((prev) => [...prev, { question: q, answer: reply }]);
                setQuestion('');
              } catch (error) {
                setAskError(error instanceof Error ? error.message : String(error));
              } finally {
                setAsking(false);
              }
            }}
            style={{ display: 'flex', gap: '6px' }}
          >
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about what was collected"
              disabled={asking}
              style={{ flex: 1, fontSize: '12px', padding: '5px 8px' }}
            />
            <button type="submit" className="secondary" disabled={asking || !question.trim()} style={{ fontSize: '11px', padding: '4px 10px' }}>
              {asking ? '…' : 'Ask'}
            </button>
          </form>
          <div style={{ fontSize: '10px', color: 'var(--text2)', marginTop: '5px' }}>
            Answered from this run's evidence only — no pages are revisited.
          </div>
        </div>
      )}
    </section>
  );
}

