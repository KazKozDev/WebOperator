import { AGENT_TOOLS } from './tools';
import { fetchWithRetry } from './http-retry';
import type { ToolCall } from './types';
import type { OllamaChatOptions, OllamaChatResult } from './ollama-client';

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: unknown;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
};

let syntheticToolCallIdSeq = 0;

export async function chatXai(opts: OllamaChatOptions, apiKey: string, xaiModel: string): Promise<OllamaChatResult> {
  if (!apiKey.trim()) throw new Error('xAI API key is empty');
  if (!xaiModel.trim()) throw new Error('xAI model is empty');

  const startedAt = Date.now();
  
  // Convert Ollama messages to xAI/OpenAI format
  const messages = opts.messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content, tool_call_id: m.tool_call_id };
    }
    
    if (m.role === 'assistant' && m.tool_calls) {
      return { 
        role: 'assistant', 
        content: m.content || null,
        ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}),
        tool_calls: m.tool_calls.map(tc => ({
          id: tc.id || tc.function.name,
          type: 'function',
          function: { name: tc.function.name, arguments: JSON.stringify(tc.function.arguments) }
        }))
      };
    }

    if (m.role === 'assistant' && m.reasoning_content) {
      return { role: 'assistant', content: m.content, reasoning_content: m.reasoning_content };
    }

    if (opts.images && opts.images.length > 0 && m === opts.messages[opts.messages.length - 1] && m.role === 'user') {
      const content = [
        { type: 'text', text: m.content },
        ...opts.images.map(img => ({
          type: 'image_url',
          image_url: { url: img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}` }
        }))
      ];
      return { role: 'user', content };
    }
    
    return { role: m.role, content: m.content };
  });

  const body = {
    model: xaiModel,
    messages,
    stream: Boolean(opts.onUpdate),
    tools: AGENT_TOOLS.map(t => ({ type: 'function', function: t.function })),
    temperature: 0.2,
  };

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(new Error('LLM Request Timeout')), 120_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutController.signal]) : timeoutController.signal;

  try {
    const res = await fetchWithRetry('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
    }, signal);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`xAI ${res.status}: ${text || res.statusText}`);
    }

    if (opts.onUpdate) return readStreamingResponseXai(res, opts, startedAt, xaiModel);

    const data = await res.json();
    const msg = data.choices?.[0]?.message ?? {};
    
    let toolCall: ToolCall | undefined;
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const func = msg.tool_calls[0].function;
      toolCall = {
        name: func.name as ToolCall['name'],
        arguments: safeJson(func.arguments),
        id: normalizeToolCallId(msg.tool_calls[0].id, func.name)
      };
    }

    // Fallback: Grok sometimes returns tool call as JSON text in content
    if (!toolCall && typeof msg.content === 'string' && msg.content.trim()) {
      const parsed = parseToolCallFromText(msg.content);
      if (parsed) toolCall = parsed;
    }

    return {
      content: typeof msg.content === 'string' ? msg.content : '',
      toolCall,
      model: data.model ?? xaiModel,
      totalMs: Date.now() - startedAt,
      evalCount: data.usage?.completion_tokens,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readStreamingResponseXai(res: Response, opts: OllamaChatOptions, startedAt: number, xaiModel: string): Promise<OllamaChatResult> {
  if (!res.body) throw new Error('xAI stream response has no body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
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
      if (!chunk || !chunk.choices || chunk.choices.length === 0) continue;
      
      const delta = chunk.choices[0].delta;
      if (!delta) continue;

      if (typeof delta.content === 'string') content += delta.content;
      
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
      
      opts.onUpdate?.({ content });
    }
  }

  let toolCall: ToolCall | undefined;
  if (lastToolCalls.length > 0) {
    const func = lastToolCalls[0].function;
    toolCall = {
      name: func.name as ToolCall['name'],
      arguments: safeJson(func.arguments),
      id: normalizeToolCallId(lastToolCalls[0].id, func.name)
    };
  }

  // Fallback: try to parse tool call from accumulated content text
  if (!toolCall && content.trim()) {
    const parsed = parseToolCallFromText(content);
    if (parsed) toolCall = parsed;
  }

  return {
    content,
    toolCall,
    model: xaiModel,
    totalMs: Date.now() - startedAt,
  };
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
    // Try to extract JSON from text
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
