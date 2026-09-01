import { AGENT_TOOLS, TOOL_NAMES, type OllamaToolDef } from './tools';
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
  numCtx?: number;
  signal?: AbortSignal;
  onUpdate?: (partial: { content: string; thinking?: string }) => void;
  /** Tool schemas available for this call. Empty means a text-only response. */
  tools?: OllamaToolDef[];
}

/** A capability the agent asked for that the model turned out not to have. */
export type DroppedCapability = 'thinking' | 'vision';

export interface OllamaChatResult {
  content: string;
  /**
   * Capabilities this request had to shed to get an answer. Only ever set on the request
   * that discovered the gap — later calls skip the capability up front — so the agent can
   * surface it once instead of on every step.
   */
  degraded?: DroppedCapability[];
  thinking?: string;
  toolCall?: ToolCall;
  toolCallSource?: 'native' | 'content';
  model: string;
  totalMs: number;
  evalCount?: number;
}

/**
 * Capabilities the agent asks for by default that a given model turns out not to have.
 * Ollama rejects both with a 400 rather than ignoring the request, and the agent asks for
 * thinking on every first step and attaches screenshots under the default vision policy —
 * so a tool-capable model missing either would fail every task before its first browser
 * action. Remembered per worker lifetime: one wasted request per model, not per step.
 */
const modelsWithoutThinking = new Set<string>();
const modelsWithoutVision = new Set<string>();

const UNSUPPORTED_THINKING = /does not support thinking/i;
const UNSUPPORTED_VISION = /does not support (?:multimodal|image|vision)/i;

export function resolveNumCtx(model: string, requestedCtx?: number): number {
  if (requestedCtx && requestedCtx >= 4096) return requestedCtx;
  const lower = (model || '').toLowerCase();
  if (lower.includes('qwen') || lower.includes('llama3') || lower.includes('deepseek') || lower.includes('mistral')) {
    return 16384;
  }
  return 8192;
}

export async function chat(opts: OllamaChatOptions): Promise<OllamaChatResult> {
  const startedAt = Date.now();
  const buildMessages = (withImages: boolean) => opts.messages.map((m) => {
    if (!withImages) {
      if (!m.images) return m;
      const { images: _dropped, ...rest } = m;
      return rest;
    }
    if (m.role === 'user' && opts.images && opts.images.length > 0 && m === opts.messages[opts.messages.length - 1]) {
      return { ...m, images: [...(m.images ?? []), ...opts.images] };
    }
    return m;
  });

  const numCtx = resolveNumCtx(opts.model, opts.numCtx);

  const activeTools = opts.tools ?? AGENT_TOOLS;
  const buildBody = (thinking: boolean, withImages: boolean) => ({
    model: opts.model,
    messages: buildMessages(withImages),
    stream: Boolean(opts.onUpdate),
    ...(activeTools.length > 0 ? { tools: activeTools } : {}),
    think: thinking,
    options: {
      temperature: 0.1,
      num_ctx: numCtx,
      ...(opts.visualTokens && withImages ? { num_image_tokens: opts.visualTokens } : {}),
    },
  });

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(new Error('LLM Request Timeout')), 120_000); // 2 min timeout
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutController.signal]) : timeoutController.signal;

  const targetUrl = normalizeOllamaUrl(opts.url);
  if (!targetUrl) {
    throw new OllamaError('Ollama URL is empty. Check settings.');
  }

  const send = (thinking: boolean, withImages: boolean) => fetch(`${targetUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildBody(thinking, withImages)),
    signal,
  });

  try {
    let useThinking = (opts.thinking ?? false) && !modelsWithoutThinking.has(opts.model);
    let withImages = !modelsWithoutVision.has(opts.model);
    const degraded: DroppedCapability[] = [];
    let res = await send(useThinking, withImages);

    // Ollama answers an unsupported capability with a 400 rather than ignoring it. Drop the
    // capability the message names and retry once per capability, so a model that is merely
    // plainer than the default still runs instead of failing the task outright.
    while (!res.ok && res.status === 400) {
      const text = await res.text().catch(() => '');
      if (useThinking && UNSUPPORTED_THINKING.test(text)) {
        modelsWithoutThinking.add(opts.model);
        useThinking = false;
        degraded.push('thinking');
      } else if (withImages && UNSUPPORTED_VISION.test(text)) {
        modelsWithoutVision.add(opts.model);
        withImages = false;
        if (opts.images?.length) degraded.push('vision');
      } else {
        throw new OllamaError(`Ollama 400: ${text || res.statusText}`, 400);
      }
      res = await send(useThinking, withImages);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const hint = res.status === 403
        ? ' Allow the extension origin in Ollama: restart Ollama with OLLAMA_ORIGINS="chrome-extension://*,http://localhost:*".'
        : '';
      throw new OllamaError(`Ollama ${res.status}: ${text || res.statusText}${hint}`, res.status);
    }

    if (opts.onUpdate) return await readStreamingResponse(res, opts, startedAt, degraded);

    const data = await res.json() as Record<string, unknown>;
    const msg = (data.message ?? {}) as { content?: unknown; thinking?: unknown; tool_calls?: unknown };
    let content = typeof msg.content === 'string' ? msg.content : '';
    let thinking = typeof msg.thinking === 'string' ? msg.thinking : undefined;

    // Separate inline <think> tags if model returned reasoning in content
    if (!thinking && content.includes('<think>')) {
      const thinkMatch = content.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
      if (thinkMatch) {
        thinking = thinkMatch[1].trim();
        content = content.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
      }
    }

    const nativeToolCall = extractToolCall(msg.tool_calls);
    const contentToolCall = nativeToolCall ? undefined : extractToolCallFromContent(content);
    const toolCall = nativeToolCall ?? contentToolCall;

    return {
      content,
      thinking,
      toolCall,
      ...(degraded.length > 0 ? { degraded } : {}),
      toolCallSource: nativeToolCall ? 'native' : contentToolCall ? 'content' : undefined,
      model: typeof data.model === 'string' ? data.model : opts.model,
      totalMs: Date.now() - startedAt,
      evalCount: typeof data.eval_count === 'number' ? data.eval_count : undefined,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readStreamingResponse(res: Response, opts: OllamaChatOptions, startedAt: number, degraded: DroppedCapability[] = []): Promise<OllamaChatResult> {
  if (!res.body) throw new OllamaError('Ollama stream response has no body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let thinking = '';
  let lastModel = opts.model;
  let lastToolCalls: unknown;
  let evalCount: number | undefined;
  let lastUpdateTime = 0;

  const emitUpdate = (force = false) => {
    const now = Date.now();
    if (force || now - lastUpdateTime >= 40) {
      lastUpdateTime = now;
      let effectiveContent = content;
      let effectiveThinking = thinking;
      if (!effectiveThinking && effectiveContent.includes('<think>')) {
        const thinkMatch = effectiveContent.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
        if (thinkMatch) {
          effectiveThinking = thinkMatch[1].trim();
          effectiveContent = effectiveContent.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
        }
      }
      opts.onUpdate?.({ content: effectiveContent, thinking: effectiveThinking || undefined });
    }
  };

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
      emitUpdate(false);
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

  emitUpdate(true);

  let finalContent = content;
  let finalThinking = thinking || undefined;
  if (!finalThinking && finalContent.includes('<think>')) {
    const thinkMatch = finalContent.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
    if (thinkMatch) {
      finalThinking = thinkMatch[1].trim();
      finalContent = finalContent.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
    }
  }

  const nativeToolCall = extractToolCall(lastToolCalls);
  const contentToolCall = nativeToolCall ? undefined : extractToolCallFromContent(finalContent);

  return {
    content: finalContent,
    thinking: finalThinking,
    toolCall: nativeToolCall ?? contentToolCall,
    ...(degraded.length > 0 ? { degraded } : {}),
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

function extractToolCall(rawCalls: unknown): ToolCall | undefined {
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) return undefined;
  const first = rawCalls[0];
  if (!first || typeof first !== 'object') return undefined;
  const fn = (first as { function?: { name?: unknown; arguments?: unknown } }).function;
  if (!fn || typeof fn.name !== 'string' || !TOOL_NAMES.includes(fn.name)) return undefined;

  let args: Record<string, unknown> = {};
  if (typeof fn.arguments === 'string') {
    const parsed = safeJsonAny(fn.arguments);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      args = parsed as Record<string, unknown>;
    }
  } else if (fn.arguments && typeof fn.arguments === 'object' && !Array.isArray(fn.arguments)) {
    args = fn.arguments as Record<string, unknown>;
  }

  return {
    name: fn.name as ToolCall['name'],
    arguments: args,
  };
}

function safeJsonAny(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function ping(url: string, signal?: AbortSignal): Promise<{ ok: boolean; models: string[]; error?: string }> {
  const targetUrl = normalizeOllamaUrl(url);
  if (!targetUrl) return { ok: false, models: [], error: 'Ollama URL is empty' };

  try {
    const res = await fetch(`${targetUrl}/api/tags`, { method: 'GET', signal });
    if (!res.ok) {
      const hint = res.status === 403
        ? ' (Ollama origin block: set OLLAMA_ORIGINS="chrome-extension://*,http://localhost:*")'
        : '';
      return { ok: false, models: [], error: `HTTP ${res.status}: ${res.statusText}${hint}` };
    }
    const data = await res.json() as { models?: Array<{ name?: unknown }> };
    const models = Array.isArray(data.models)
      ? data.models.map((m) => (typeof m.name === 'string' ? m.name : '')).filter(Boolean)
      : [];
    return { ok: true, models };
  } catch (err) {
    return { ok: false, models: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export function normalizeOllamaUrl(raw: string): string {

  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `http://${trimmed}`;
}

export class OllamaError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'OllamaError';
    this.status = status;
  }
}
