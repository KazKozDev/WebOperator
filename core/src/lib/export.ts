import type { AgentTask } from './types';
import { maskTaskForLog } from './masking';

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
