import type { AgentTask, AgentStep, AgentPlan } from './types';
import { maskTaskForLog } from './masking';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';

export interface TraceFile {
  version: 1;
  exportedAt: number;
  task: AgentTask;
}

export function buildTrace(task: AgentTask): TraceFile {
  return { version: 1, exportedAt: Date.now(), task: maskTaskForLog(task) };
}

export function downloadJson(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── PDF Export ──

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'done': return '✓ Completed';
    case 'failed': return '✕ Failed';
    case 'stopped': return '⏹ Stopped — partial result';
    case 'paused': return '⏸ Paused';
    case 'running': return '⟳ Running';
    default: return status;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'done': case 'ok': return '#22c55e';
    case 'failed': case 'fail': return '#ef4444';
    case 'stopped': case 'paused': return '#f59e0b';
    case 'running': return '#3b82f6';
    case 'skipped': return '#94a3b8';
    default: return '#64748b';
  }
}

function renderPlan(plan: AgentPlan): string {
  const rows = plan.steps.map((step) => {
    const color = statusColor(step.status);
    const icon = step.status === 'done' ? '✓' : step.status === 'active' ? '▶' : '○';
    return `<tr>
      <td style="width:30px;text-align:center;color:${color};font-weight:600">${icon}</td>
      <td style="padding:4px 8px">${escapeHtml(step.description)}</td>
      <td style="width:70px;text-align:right;color:${color};font-size:11px">${step.status}</td>
    </tr>`;
  }).join('');

  return `
    <div class="section">
      <h2>Plan${plan.intent ? ` — ${escapeHtml(plan.intent)}` : ''}</h2>
      <table style="width:100%;border-collapse:collapse">
        ${rows}
      </table>
    </div>`;
}

function renderStep(step: AgentStep, index: number): string {
  const color = statusColor(step.status);
  const toolName = step.toolCall?.name ?? '—';
  const args = step.toolCall?.arguments
    ? Object.entries(step.toolCall.arguments)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${escapeHtml(v.length > 60 ? v.slice(0, 60) + '…' : v)}"` : JSON.stringify(v)}`)
        .join(', ')
    : '';
  const note = step.note ? escapeHtml(step.note.length > 200 ? step.note.slice(0, 200) + '…' : step.note) : '';
  const duration = step.timings?.totalMs ? formatDuration(step.timings.totalMs) : '';
  const resultOk = step.result?.ok;
  const resultError = step.result?.error ? escapeHtml(step.result.error.slice(0, 150)) : '';
  const url = step.snapshot?.url ?? '';
  const urlShort = url.length > 80 ? url.slice(0, 80) + '…' : url;

  return `
    <tr class="step-row">
      <td style="width:35px;text-align:center;color:${color};font-weight:600;vertical-align:top;padding-top:6px">${index + 1}</td>
      <td style="padding:4px 8px;vertical-align:top">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <strong style="color:#1e293b">${escapeHtml(toolName)}</strong>
          <span style="font-size:10px;color:#94a3b8">${duration}</span>
        </div>
        ${args ? `<div style="font-size:11px;color:#64748b;margin-top:2px;word-break:break-all">${args}</div>` : ''}
        ${urlShort ? `<div style="font-size:10px;color:#94a3b8;margin-top:1px">${escapeHtml(urlShort)}</div>` : ''}
        ${note ? `<div style="font-size:11px;color:#475569;margin-top:3px">${note}</div>` : ''}
        ${resultError ? `<div style="font-size:11px;color:#ef4444;margin-top:2px">Error: ${resultError}</div>` : ''}
        ${resultOk === false && !resultError ? `<div style="font-size:11px;color:#ef4444;margin-top:2px">Action failed</div>` : ''}
      </td>
      <td style="width:45px;text-align:center;vertical-align:top;padding-top:6px">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color}"></span>
      </td>
    </tr>`;
}

export function buildPdfHtml(task: AgentTask): string {
  const masked = maskTaskForLog(task);
  const totalMs = masked.steps.length > 0
    ? (masked.steps[masked.steps.length - 1].finishedAt ?? masked.updatedAt) - masked.steps[0].startedAt
    : 0;

  const stepsHtml = masked.steps
    .filter((s) => s.toolCall)
    .map((s, i) => renderStep(s, i))
    .join('');

  const planHtml = masked.plan ? renderPlan(masked.plan) : '';

  // A stopped run never reaches `done`, so its report carries the summary of
  // what was collected instead — and says so, rather than passing a partial
  // result off as the answer.
  const doneAnswer = masked.steps.slice().reverse()
    .find((s) => s.toolCall?.name === 'done')?.toolCall?.arguments?.answer as string | undefined;
  const answer = doneAnswer ?? (masked.status === 'stopped' ? masked.partialSummary : undefined);
  const answerHtml = answer
    ? `<div class="section answer-section">
        <h2>${masked.status === 'stopped' && !doneAnswer ? 'Partial result — run was stopped' : 'Answer'}</h2>
        <div class="answer-text">${escapeHtml(answer)}</div>
      </div>`
    : '';

  const errorHtml = masked.error
    ? `<div class="section" style="border-left:3px solid #ef4444;padding-left:12px">
        <h2 style="color:#ef4444">Error</h2>
        <p style="color:#64748b">${escapeHtml(masked.error)}</p>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Task Report — ${escapeHtml(masked.goal.slice(0, 60))}</title>
  <style>
    @page {
      margin: 15mm 12mm;
      size: A4;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      line-height: 1.5;
      color: #1e293b;
      background: #fff;
    }
    .header {
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .header h1 {
      font-size: 18px;
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 8px;
    }
    .header-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      font-size: 11px;
      color: #64748b;
    }
    .header-meta .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 600;
    }
    .section {
      margin-bottom: 16px;
      page-break-inside: avoid;
    }
    .section h2 {
      font-size: 13px;
      font-weight: 600;
      color: #334155;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid #e2e8f0;
    }
    .answer-section {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 6px;
      padding: 12px;
    }
    .answer-text {
      color: #166534;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    table { width: 100%; border-collapse: collapse; }
    .step-row { border-bottom: 1px solid #f1f5f9; }
    .step-row td { padding: 5px 4px; }
    .footer {
      margin-top: 20px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      font-size: 10px;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(masked.goal)}</h1>
    <div class="header-meta">
      <span class="badge" style="background:${statusColor(masked.status)}20;color:${statusColor(masked.status)}">${statusLabel(masked.status)}</span>
      <span>Started: ${formatDate(masked.createdAt)}</span>
      ${totalMs > 0 ? `<span>Duration: ${formatDuration(totalMs)}</span>` : ''}
      <span>Steps: ${masked.steps.filter((s) => s.toolCall).length}</span>
      ${masked.modelUsed ? `<span>Model: ${escapeHtml(masked.modelUsed)}</span>` : ''}
    </div>
  </div>

  ${answerHtml}
  ${errorHtml}
  ${planHtml}

  <div class="section">
    <h2>Execution Steps</h2>
    <table>
      ${stepsHtml || '<tr><td style="color:#94a3b8;padding:8px">No steps recorded</td></tr>'}
    </table>
  </div>

  <div class="footer">
    <span>WebOperator Task Report</span>
    <span>Exported ${formatDate(Date.now())} · Task ID: ${masked.id.slice(0, 8)}</span>
  </div>
</body>
</html>`;
}

export function downloadPdfViaPrint(task: AgentTask): void {
  const html = buildPdfHtml(task);

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:794px;height:1123px;border:none;';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    // Fallback: download as HTML
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${task.id.slice(0, 8)}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  // Keep print synchronous with the button click. Chrome only permits print dialogs
  // initiated during a user gesture; scheduling this even one tick later causes the
  // dialog to be silently blocked from the extension side panel.
  const cleanup = () => iframe.remove();
  iframe.contentWindow?.addEventListener('afterprint', cleanup, { once: true });

  try {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
  } catch {
    // If printing is unavailable, provide the rendered report as a usable fallback.
    cleanup();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${task.id.slice(0, 8)}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  // Some browsers do not dispatch afterprint for an iframe. Keep it alive long
  // enough for the print preview, then remove it without leaving hidden frames.
  setTimeout(cleanup, 30_000);
}

function printableValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildPdfDefinition(task: AgentTask): TDocumentDefinitions {
  const masked = maskTaskForLog(task);
  const toolSteps = masked.steps.filter((step) => step.toolCall);
  const lastStep = masked.steps.at(-1);
  const totalMs = masked.steps.length > 0
    ? (lastStep?.finishedAt ?? masked.updatedAt) - masked.steps[0].startedAt
    : 0;
  const answer = [...masked.steps].reverse()
    .find((step) => step.toolCall?.name === 'done')?.toolCall?.arguments.answer;

  const content: Content[] = [
    { text: 'WebOperator Task Report', style: 'eyebrow' },
    { text: masked.goal, style: 'title' },
    {
      columns: [
        { text: statusLabel(masked.status), color: statusColor(masked.status), bold: true },
        { text: `Started: ${formatDate(masked.createdAt)}` },
        { text: totalMs > 0 ? `Duration: ${formatDuration(totalMs)}` : '' },
        { text: `Steps: ${toolSteps.length}`, alignment: 'right' },
      ],
      columnGap: 12,
      margin: [0, 0, 0, 18],
      fontSize: 9,
      color: '#64748b',
    },
  ];

  if (answer !== undefined) {
    content.push(
      { text: 'ANSWER', style: 'sectionTitle' },
      {
        table: { widths: ['*'], body: [[{ text: printableValue(answer), color: '#166534', margin: 8 }]] },
        layout: {
          fillColor: () => '#f0fdf4',
          hLineColor: () => '#bbf7d0',
          vLineColor: () => '#bbf7d0',
        },
        margin: [0, 0, 0, 16],
      },
    );
  }

  if (masked.error) {
    content.push(
      { text: 'ERROR', style: 'sectionTitle', color: '#ef4444' },
      { text: masked.error, color: '#b91c1c', margin: [0, 0, 0, 16] },
    );
  }

  if (masked.plan) {
    const planRows: TableCell[][] = masked.plan.steps.map((step) => [
      { text: step.status === 'done' ? '✓' : step.status === 'active' ? '▶' : '○', color: statusColor(step.status), alignment: 'center' },
      { text: step.description },
      { text: step.status, color: statusColor(step.status), alignment: 'right', fontSize: 8 },
    ]);
    content.push(
      { text: masked.plan.intent ? `PLAN — ${masked.plan.intent}` : 'PLAN', style: 'sectionTitle' },
      {
        table: { widths: [18, '*', 55], body: planRows },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 16],
      },
    );
  }

  const stepRows: TableCell[][] = toolSteps.map((step, index) => {
    const call = step.toolCall!;
    const args = Object.entries(call.arguments)
      .map(([key, value]) => `${key}=${printableValue(value)}`)
      .join(', ');
    const details = [args, step.note, step.result?.error ? `Error: ${step.result.error}` : undefined]
      .filter(Boolean)
      .join('\n');
    const actionCell: TableCell = {
      stack: [
        { text: call.name, bold: true, color: '#1e293b' },
        ...(details ? [{ text: details, color: step.result?.error ? '#b91c1c' : '#64748b', fontSize: 8, margin: [0, 2, 0, 0] as [number, number, number, number] }] : []),
      ],
    };
    return [
      { text: String(index + 1), color: statusColor(step.status), bold: true, alignment: 'center' },
      actionCell,
      { text: step.timings?.totalMs ? formatDuration(step.timings.totalMs) : '', alignment: 'right', color: '#94a3b8', fontSize: 8 },
    ];
  });

  content.push(
    { text: 'EXECUTION STEPS', style: 'sectionTitle' },
    stepRows.length > 0
      ? { table: { headerRows: 1, widths: [24, '*', 55], body: [[{ text: '#', bold: true }, { text: 'Action', bold: true }, { text: 'Time', bold: true, alignment: 'right' }], ...stepRows] }, layout: 'lightHorizontalLines' }
      : { text: 'No steps recorded', color: '#94a3b8', italics: true },
  );

  return {
    pageSize: 'A4',
    pageMargins: [42, 46, 42, 46],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: '#334155', lineHeight: 1.25 },
    styles: {
      eyebrow: { fontSize: 8, bold: true, color: '#64748b', characterSpacing: 1.2, margin: [0, 0, 0, 5] },
      title: { fontSize: 18, bold: true, color: '#0f172a', margin: [0, 0, 0, 10] },
      sectionTitle: { fontSize: 10, bold: true, color: '#334155', characterSpacing: 0.6, margin: [0, 8, 0, 7] },
    },
    content,
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: `Task ID: ${masked.id.slice(0, 8)}`, alignment: 'left' },
        { text: `${currentPage} / ${pageCount}`, alignment: 'right' },
      ],
      margin: [42, 0],
      fontSize: 8,
      color: '#94a3b8',
    }),
    info: { title: `WebOperator — ${masked.goal.slice(0, 80)}`, creator: 'WebOperator' },
  };
}

export async function downloadPdf(task: AgentTask): Promise<void> {
  // pdfmake carries its fonts as ~1.5 MB of base64 in vfs_fonts. Imported statically it lands in
  // the side panel's startup bundle — parsed on every open, for a button most sessions never
  // press. Loaded here it costs nothing until someone actually exports a PDF.
  const [{ default: pdfMake }, { default: pdfFonts }] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  pdfMake.addVirtualFileSystem(pdfFonts);
  await pdfMake.createPdf(buildPdfDefinition(task)).download(`report-${task.id.slice(0, 8)}.pdf`);
}
