import { AGENT_TOOLS, TOOL_NAMES } from './tools';
import type { ToolCall } from './types';

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: Array<{
    id?: string;
    function: { name: string; arguments: Record<string, unknown> };
  }>;
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface OllamaChatOptions {
  url: string;
  model: string;
  messages: OllamaMessage[];
  thinking?: boolean;
  images?: string[];
  visualTokens?: number;
  signal?: AbortSignal;
  onUpdate?: (partial: { content: string; thinking?: string }) => void;
}

export interface OllamaChatResult {
  content: string;
  thinking?: string;
  toolCall?: ToolCall;
  toolCallSource?: 'native' | 'content';
  model: string;
  totalMs: number;
  evalCount?: number;
}

export async function chat(opts: OllamaChatOptions): Promise<OllamaChatResult> {
  const startedAt = Date.now();
  const messages = opts.messages.map((m) => {
    if (m.role === 'user' && opts.images && opts.images.length > 0 && m === opts.messages[opts.messages.length - 1]) {
      return { ...m, images: [...(m.images ?? []), ...opts.images] };
    }
    return m;
  });

  const body = {
    model: opts.model,
    messages,
    stream: Boolean(opts.onUpdate),
    tools: AGENT_TOOLS,
    think: opts.thinking ?? false,
    options: {
      temperature: 0.2,
      num_ctx: 8192,
      ...(opts.visualTokens ? { num_image_tokens: opts.visualTokens } : {}),
    },
  };

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(new Error('LLM Request Timeout')), 120_000); // 2 min timeout
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutController.signal]) : timeoutController.signal;

  try {
    const res = await fetch(`${trimTrailing(opts.url)}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });


  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const hint = res.status === 403
      ? ' Allow the extension origin in Ollama: restart Ollama with OLLAMA_ORIGINS="chrome-extension://*,http://localhost:*".'
      : '';
    throw new OllamaError(`Ollama ${res.status}: ${text || res.statusText}${hint}`, res.status);
  }

  if (opts.onUpdate) return readStreamingResponse(res, opts, startedAt);

  const data = await res.json();
  const msg = data.message ?? {};
  const content = typeof msg.content === 'string' ? msg.content : '';
  const nativeToolCall = extractToolCall(msg.tool_calls);
  const contentToolCall = nativeToolCall ? undefined : extractToolCallFromContent(content);
  const toolCall = nativeToolCall ?? contentToolCall;

  return {
    content,
    thinking: typeof msg.thinking === 'string' ? msg.thinking : undefined,
    toolCall,
    toolCallSource: nativeToolCall ? 'native' : contentToolCall ? 'content' : undefined,
    model: data.model ?? opts.model,
    totalMs: Date.now() - startedAt,
    evalCount: data.eval_count,
  };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readStreamingResponse(res: Response, opts: OllamaChatOptions, startedAt: number): Promise<OllamaChatResult> {
  if (!res.body) throw new OllamaError('Ollama stream response has no body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let thinking = '';
  let lastModel = opts.model;
  let lastToolCalls: unknown;
  let evalCount: number | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const chunk = safeJsonAny(trimmed);
      if (!chunk || typeof chunk !== 'object') continue;
      const msg = (chunk as { message?: { content?: string; thinking?: string; tool_calls?: unknown }; model?: string; eval_count?: number }).message ?? {};
      if (typeof msg.content === 'string') content += msg.content;
      if (typeof msg.thinking === 'string') thinking += msg.thinking;
      if (msg.tool_calls) lastToolCalls = msg.tool_calls;
      if (typeof (chunk as { model?: string }).model === 'string') lastModel = (chunk as { model: string }).model;
      if (typeof (chunk as { eval_count?: number }).eval_count === 'number') evalCount = (chunk as { eval_count: number }).eval_count;
      opts.onUpdate?.({ content, thinking: thinking || undefined });
    }
  }

  const tail = buffer.trim();
  if (tail) {
    const chunk = safeJsonAny(tail);
    const msg = (chunk as { message?: { content?: string; thinking?: string; tool_calls?: unknown } } | undefined)?.message ?? {};
    if (typeof msg.content === 'string') content += msg.content;
    if (typeof msg.thinking === 'string') thinking += msg.thinking;
    if (msg.tool_calls) lastToolCalls = msg.tool_calls;
  }

  const nativeToolCall = extractToolCall(lastToolCalls);
  const contentToolCall = nativeToolCall ? undefined : extractToolCallFromContent(content);

  return {
    content,
    thinking: thinking || undefined,
    toolCall: nativeToolCall ?? contentToolCall,
    toolCallSource: nativeToolCall ? 'native' : contentToolCall ? 'content' : undefined,
    model: lastModel,
    totalMs: Date.now() - startedAt,
    evalCount,
  };
}

function extractToolCallFromContent(content: string): ToolCall | undefined {
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

function stripCodeFence(content: string): string {
  const match = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : content;
}

function extractToolCall(calls: unknown): ToolCall | undefined {
  if (!Array.isArray(calls) || calls.length === 0) return undefined;
  const first = calls[0] as { function?: { name?: string; arguments?: unknown } };
  const name = first?.function?.name;
  if (!name || !TOOL_NAMES.includes(name)) return undefined;
  const rawArgs = first.function!.arguments;
  const args: Record<string, unknown> =
    typeof rawArgs === 'string' ? safeJson(rawArgs) : (rawArgs as Record<string, unknown>) ?? {};
  return { name: name as ToolCall['name'], arguments: args };
}

function safeJson(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw); } catch { return {}; }
}

function safeJsonAny(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return undefined; }
}

function trimTrailing(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export async function ping(url: string, signal?: AbortSignal): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    const res = await fetch(`${trimTrailing(url)}/api/tags`, { signal });
    if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
    const data = await res.json();
    const models = Array.isArray(data.models) ? data.models.map((m: { name: string }) => m.name) : [];
    return { ok: true, models };
  } catch (err) {
    return { ok: false, models: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export class OllamaError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'OllamaError';
  }
}
