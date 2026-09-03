import { TOOL_NAMES } from './tools';
import type { ToolCall } from './types';

export function safeJsonAny(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function stripCodeFence(content: string): string {
  const match = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : content;
}

/**
 * A tool call the model wrote into its text instead of the API's tool_calls field.
 * Local models do this often enough that dropping the response would fail the step
 * over formatting alone, so every provider that can hit one parses the content too.
 */
export function extractToolCallFromContent(content: string): ToolCall | undefined {
  const trimmed = stripCodeFence(content.trim());
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  const parsed = safeJsonAny(trimmed);
  if (!parsed || typeof parsed !== 'object') return undefined;

  const raw = parsed as { name?: unknown; arguments?: unknown };
  if (typeof raw.name !== 'string' || !TOOL_NAMES.includes(raw.name)) return undefined;
  const args = raw.arguments && typeof raw.arguments === 'object'
    ? raw.arguments as Record<string, unknown>
    : {};
  return { name: raw.name as ToolCall['name'], arguments: args };
}
