import { AGENT_TOOLS } from './tools';
import type { ToolCall } from './types';
import type { OllamaChatOptions, OllamaChatResult } from './ollama-client';

export async function chatMlx(opts: OllamaChatOptions, apiKey: string, model: string): Promise<OllamaChatResult> {
  if (!model.trim()) throw new Error('MLX model is empty');

  const startedAt = Date.now();
  const messages = opts.messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content, tool_call_id: m.tool_call_id };
    }

    if (m.role === 'assistant' && m.tool_calls) {
      return {
        role: 'assistant',
        content: m.content || null,
        ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}),
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id || tc.function.name,
          type: 'function',
          function: { name: tc.function.name, arguments: JSON.stringify(tc.function.arguments) },
        })),
      };
    }

    if (m.role === 'assistant' && m.reasoning_content) {
      return { role: 'assistant', content: m.content, reasoning_content: m.reasoning_content };
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
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey.trim()) headers.authorization = `Bearer ${apiKey}`;

    const res = await fetch('http://127.0.0.1:8000/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        tools: AGENT_TOOLS.map((t) => ({ type: 'function', function: t.function })),
        temperature: 0.2,
      }),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`MLX ${res.status}: ${text || res.statusText}`);
    }

    const data = await res.json();
    const msg = data.choices?.[0]?.message ?? {};
    let toolCall: ToolCall | undefined;
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const func = msg.tool_calls[0].function;
      toolCall = {
        name: func.name as ToolCall['name'],
        arguments: safeJson(func.arguments),
        id: msg.tool_calls[0].id,
      };
    }

    const content = typeof msg.content === 'string' ? msg.content : '';

    opts.onUpdate?.({ content });

    return {
      content,
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

function safeJson(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw); } catch { return {}; }
}
