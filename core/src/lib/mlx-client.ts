import { AGENT_TOOLS } from './tools';
import { fetchWithRetry } from './http-retry';
import { extractToolCallFromContent } from './tool-call-parse';
import type { ToolCall } from './types';
import type { OllamaChatOptions, OllamaChatResult } from './ollama-client';

let syntheticToolCallIdSeq = 0;

/** Output ceiling per step. Keeps one step inside the request timeout below. */
const MAX_OUTPUT_TOKENS = 1024;

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
    const activeTools = opts.tools ?? AGENT_TOOLS;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey.trim()) headers.authorization = `Bearer ${apiKey}`;

    const res = await fetchWithRetry('http://127.0.0.1:8000/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        ...(activeTools.length > 0 ? { tools: activeTools.map((t) => ({ type: 'function', function: t.function })) } : {}),
        // mlx-vlm defaults to 2048 when the caller stays quiet, and an 8B at ~20 tok/s spends
        // ~100s filling that — past the 120s abort below, so a talkative model hangs every step
        // instead of failing. A tool call needs a few hundred tokens; the rest is the model
        // thinking out loud, and a step that needs more than this is too slow for the loop anyway.
        max_tokens: MAX_OUTPUT_TOKENS,
        // Without this the agent's thinking policy never reached MLX: the server fell back to
        // its own --enable-thinking default, so "Thinking: Never" changed nothing here.
        enable_thinking: opts.thinking ?? false,
        temperature: 0.2,
      }),
    }, signal);

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
        id: normalizeToolCallId(msg.tool_calls[0].id, func.name),
      };
    }

    const content = typeof msg.content === 'string' ? msg.content : '';

    // Qwen3-VL under mlx-vlm routinely writes the call into the text instead of
    // tool_calls. Without this the step fails on formatting alone, and the repair
    // round-trip that follows just re-rolls the same reply at full cost.
    const contentToolCall = toolCall ? undefined : extractToolCallFromContent(content);
    if (contentToolCall) toolCall = contentToolCall;

    opts.onUpdate?.({ content });

    return {
      content,
      toolCall,
      toolCallSource: toolCall ? (contentToolCall ? 'content' : 'native') : undefined,
      model: data.model ?? model,
      totalMs: Date.now() - startedAt,
      evalCount: data.usage?.completion_tokens,
      thinking: typeof msg.reasoning_content === 'string' ? msg.reasoning_content : undefined,
    };
  } finally {
    clearTimeout(timeoutId);
  }
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
