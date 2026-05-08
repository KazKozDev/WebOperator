import type { A11ySnapshot, AgentStep, AgentTask, ToolCall } from './types';

export function maskCallForLog(call: ToolCall, snapshot?: A11ySnapshot): ToolCall {
  if (call.name !== 'type') return call;
  const ref = String(call.arguments.ref ?? '');
  const node = snapshot?.nodes.find((n) => n.ref === ref);
  const looksLikePassword = node?.value === '••••••' || isPasswordName(node?.name);
  if (!looksLikePassword) return call;
  return { ...call, arguments: { ...call.arguments, text: '••••••' } };
}

export function maskStepForStorage(step: AgentStep): AgentStep {
  if (!step.toolCall) return step;
  const masked = maskCallForLog(step.toolCall, step.snapshot);
  if (masked === step.toolCall) return step;
  return { ...step, toolCall: masked };
}

export function maskTaskForLog(task: AgentTask): AgentTask {
  return { ...task, steps: task.steps.map(maskStepForStorage) };
}

function isPasswordName(name?: string): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return n.includes('password') || n.includes('пароль') || n === 'pwd' || n.includes('passphrase');
}
