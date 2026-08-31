import { frameIdFromRef } from './frames';
import type { A11ySnapshot, ToolCall } from './types';

export const BATCH_MIN_ACTIONS = 2;
export const BATCH_MAX_ACTIONS = 5;

const BATCHABLE_NAMES = new Set<ToolCall['name']>(['click', 'type', 'press', 'select']);
const SAFE_CLICK_ROLES = new Set(['button', 'checkbox', 'radio', 'switch', 'tab']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseBatchActions(call: ToolCall): ToolCall[] {
  if (call.name !== 'batch_actions' || !Array.isArray(call.arguments.actions)) return [];
  return call.arguments.actions.flatMap((raw): ToolCall[] => {
    if (!isRecord(raw) || typeof raw.name !== 'string') return [];
    const nestedArgs = isRecord(raw.arguments) ? raw.arguments : undefined;
    const argumentsValue = nestedArgs ?? Object.fromEntries(
      Object.entries(raw).filter(([key]) => key !== 'name' && key !== 'arguments'),
    );
    return [{ name: raw.name as ToolCall['name'], arguments: argumentsValue }];
  });
}

export function batchPrimaryRef(call: ToolCall): string {
  return parseBatchActions(call)
    .map((action) => String(action.arguments.ref ?? ''))
    .find(Boolean) ?? '';
}

export function validateBatchCall(
  call: ToolCall,
  snapshot?: Pick<A11ySnapshot, 'nodes'>,
  confirmKeywords: string[] = [],
): string | undefined {
  if (call.name !== 'batch_actions') return undefined;
  if (!Array.isArray(call.arguments.actions)) return 'batch_actions requires an actions array';

  const actions = parseBatchActions(call);
  if (actions.length !== call.arguments.actions.length) return 'Every batch item must be an object with a valid name';
  if (actions.length < BATCH_MIN_ACTIONS || actions.length > BATCH_MAX_ACTIONS) {
    return `batch_actions requires ${BATCH_MIN_ACTIONS}-${BATCH_MAX_ACTIONS} actions`;
  }

  const frameIds = new Set<number>();
  for (const [index, action] of actions.entries()) {
    if (!BATCHABLE_NAMES.has(action.name)) return `Action ${index + 1} uses forbidden tool ${action.name}`;

    const ref = typeof action.arguments.ref === 'string' ? action.arguments.ref : '';
    if (action.name !== 'press' && !ref) return `Action ${index + 1} (${action.name}) requires ref`;
    if (ref) {
      frameIds.add(frameIdFromRef(ref));
      const node = snapshot?.nodes.find((candidate) => candidate.ref === ref);
      if (snapshot && !node) return `Action ${index + 1} references missing element ${ref}`;
      if (action.name === 'click' && node && (!SAFE_CLICK_ROLES.has(node.role) || node.href)) {
        return `Action ${index + 1} cannot batch click ${node.role} ${ref}; links and navigation-like targets must run separately`;
      }
      if (node) {
        const label = `${node.name} ${node.value ?? ''}`.toLowerCase();
        if (confirmKeywords.some((keyword) => keyword && label.includes(keyword.toLowerCase()))) {
          return `Action ${index + 1} targets a confirmation-sensitive control and must run separately`;
        }
      }
    }

    if (action.name === 'type') {
      if (typeof action.arguments.text !== 'string') return `Action ${index + 1} (type) requires text`;
      if (String(action.arguments.submit ?? 'false') === 'true') return `Action ${index + 1} cannot submit from a batch`;
    }
    if (action.name === 'select' && typeof action.arguments.value !== 'string') {
      return `Action ${index + 1} (select) requires value`;
    }
    if (action.name === 'press') {
      const key = String(action.arguments.key ?? '').trim();
      if (!key) return `Action ${index + 1} (press) requires key`;
      if (key.toLowerCase() === 'enter') return `Action ${index + 1} cannot press Enter from a batch`;
    }
  }

  if (frameIds.size > 1) return 'All batched actions must target the same frame';
  return undefined;
}
