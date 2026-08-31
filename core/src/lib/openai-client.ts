import { AGENT_TOOLS } from './tools';
import { fetchWithRetry } from './http-retry';
import type { ToolCall } from './types';
import type { OllamaChatOptions, OllamaChatResult } from './ollama-client';

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: unknown;
      reasoning_content?: unknown;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
};

let syntheticToolCallIdSeq = 0;

export async function chatOpenAI(opts: OllamaChatOptions, apiKey: string, model: string): Promise<OllamaChatResult> {
  return chatOpenAICompatible({
    opts,
    apiKey,
    model,
    label: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
  });
}

export async function chatOpenAICompatible({
  opts,
  apiKey,
  model,
  label,
  url,
}: {
  opts: OllamaChatOptions;
  apiKey: string;
  model: string;
  label: string;
  url: string;
}): Promise<OllamaChatResult> {
  if (!apiKey.trim()) throw new Error(`${label} API key is empty`);
  if (!model.trim()) throw new Error(`${label} model is empty`);

  const startedAt = Date.now();
  const messages = opts.messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content, tool_call_id: m.tool_call_id };
    }

    if (m.role === 'assistant' && m.tool_calls) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id || tc.function.name,
          type: 'function',
          function: { name: tc.function.name, arguments: JSON.stringify(tc.function.arguments) },
        })),
      };
    }

    if (opts.images && opts.images.length > 0 && m === opts.messages[opts.messages.length - 1] && m.role === 'user') {
      return {
        role: 'user',
        content: [
          { type: 'text', text: m.content },
          ...opts.images.map((img) => ({
            type: 'image_url',
            image_url: { url: img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}` },
          })),
        ],
      };
    }

    return { role: m.role, content: m.content };
  });

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(new Error('LLM Request Timeout')), 120_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutController.signal]) : timeoutController.signal;

  try {
    const activeTools = opts.tools ?? AGENT_TOOLS;
    const toolPayload = activeTools.map((t) => ({ type: 'function', function: t.function }));
    const body = {
      model,
      messages,
      stream: Boolean(opts.onUpdate),
      ...(toolPayload.length > 0 ? { tools: toolPayload } : {}),
      temperature: 0.2,
    };
    let res = await requestChatCompletions(url, apiKey, body, signal);

    if (!res.ok && res.status === 400) {
      const text = await res.text().catch(() => '');
      if (/temperature/i.test(text)) {
        const fallbackBody = {
          model,
          messages,
          stream: Boolean(opts.onUpdate),
          ...(toolPayload.length > 0 ? { tools: toolPayload } : {}),
        };
        res = await requestChatCompletions(url, apiKey, fallbackBody, signal);
      } else {
        throw new Error(`${label} ${res.status}: ${text || res.statusText}`);
      }
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${label} ${res.status}: ${text || res.statusText}`);
    }

    if (opts.onUpdate) return readStreamingResponseOpenAICompatible(res, opts, startedAt, model, label);

    const data = await res.json();
    const msg = data.choices?.[0]?.message ?? {};
    let toolCall: ToolCall | undefined;
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const func = msg.tool_calls[0].function;
      toolCall = {
        name: func.name as ToolCall['name'],
        arguments: safeJson(func.arguments),
        id: normalizeToolCallId(msg.tool_calls[0].id, func.name),
      };
    }

    if (!toolCall && typeof msg.content === 'string' && msg.content.trim()) {
      const parsed = parseToolCallFromText(msg.content);
      if (parsed) toolCall = parsed;
    }

    return {
      content: typeof msg.content === 'string' ? msg.content : '',
      toolCall,
      model: data.model ?? model,
      totalMs: Date.now() - startedAt,
      evalCount: data.usage?.completion_tokens,
      thinking: typeof msg.reasoning_content === 'string' ? msg.reasoning_content : undefined,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function requestChatCompletions(url: string, apiKey: string, body: unknown, signal: AbortSignal): Promise<Response> {
  return fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  }, signal);
}

async function readStreamingResponseOpenAICompatible(res: Response, opts: OllamaChatOptions, startedAt: number, model: string, label: string): Promise<OllamaChatResult> {
  if (!res.body) throw new Error(`${label} stream response has no body`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  const lastToolCalls: Array<{ id?: string; function: { name?: string; arguments: string } }> = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      if (trimmed === 'data: [DONE]') continue;

      const chunk = safeJsonAny(trimmed.slice(6)) as ChatCompletionChunk | undefined;
      const delta = chunk?.choices?.[0]?.delta;
      if (!delta) continue;

      if (typeof delta.content === 'string') content += delta.content;
      if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content;

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!lastToolCalls[tc.index]) {
            lastToolCalls[tc.index] = { function: { arguments: '' } };
          }
          if (tc.id) lastToolCalls[tc.index].id = tc.id;
          if (tc.function?.name) lastToolCalls[tc.index].function.name = tc.function.name;
          if (tc.function?.arguments) lastToolCalls[tc.index].function.arguments += tc.function.arguments;
        }
      }

      opts.onUpdate?.({ content, thinking: reasoning || undefined });
    }
  }

  let toolCall: ToolCall | undefined;
  if (lastToolCalls.length > 0) {
    const func = lastToolCalls[0].function;
    toolCall = {
      name: func.name as ToolCall['name'],
      arguments: safeJson(func.arguments),
      id: normalizeToolCallId(lastToolCalls[0].id, func.name),
    };
  }

  if (!toolCall && content.trim()) {
    const parsed = parseToolCallFromText(content);
    if (parsed) toolCall = parsed;
  }

  return { content, toolCall, model, totalMs: Date.now() - startedAt, thinking: reasoning || undefined };
}

function parseToolCallFromText(text: string): ToolCall | undefined {
  try {
    const t = text.trim().replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '').trim();
    const obj = JSON.parse(t);
    if (obj && typeof obj === 'object' && 'name' in obj && 'arguments' in obj) {
      return {
        name: obj.name as ToolCall['name'],
        arguments: obj.arguments as Record<string, unknown>,
        id: undefined,
      };
    }
  } catch {
    const m = text.match(/\{[^{}]*"name"\s*:\s*"[^"]+"[^{}]*\}/s);
    if (m) {
      try {
        const obj = JSON.parse(m[0]);
        if (obj && typeof obj === 'object' && 'name' in obj && 'arguments' in obj) {
          return {
            name: obj.name as ToolCall['name'],
            arguments: obj.arguments as Record<string, unknown>,
            id: undefined,
          };
        }
      } catch {}
    }
  }
  return undefined;
}

function normalizeToolCallId(id: unknown, name: unknown): string {
  const rawId = typeof id === 'string' ? id.trim() : '';
  if (rawId) return rawId;
  const rawName = typeof name === 'string' && name.trim() ? name.trim() : 'tool';
  syntheticToolCallIdSeq += 1;
  return `call_${rawName}_${syntheticToolCallIdSeq}`;
}

function safeJson(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function safeJsonAny(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return undefined; }
}
