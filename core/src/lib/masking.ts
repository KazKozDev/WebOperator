import type { A11ySnapshot, AgentStep, AgentTask, ToolCall } from './types';
import { parseBatchActions } from './batch-actions';

export function maskCallForLog(call: ToolCall, snapshot?: A11ySnapshot): ToolCall {
  if (call.name === 'batch_actions') {
    const actions = parseBatchActions(call);
    const maskedActions = actions.map((action) => {
      const masked = maskCallForLog(action, snapshot);
      return { name: masked.name, ...masked.arguments };
    });
    return { ...call, arguments: { ...call.arguments, actions: maskedActions } };
  }
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
