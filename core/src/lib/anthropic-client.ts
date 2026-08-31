/**
 * Direct Anthropic Messages API client for Claude models.
 * Supports tool use, streaming, thinking/reasoning blocks, and system prompts.
 */

import { AGENT_TOOLS } from './tools';
import type { AgentActionName, ToolCall } from './types';
import type { OllamaChatOptions, OllamaChatResult } from './ollama-client';

export async function chatAnthropic(
  opts: OllamaChatOptions,
  apiKey: string,
  model: string = 'claude-3-7-sonnet-20250219'
): Promise<OllamaChatResult> {
  if (!apiKey?.trim()) throw new Error('Anthropic API key is empty');
  if (!model?.trim()) throw new Error('Anthropic model is empty');

  const startedAt = Date.now();

  // Convert tools to Anthropic format
  const tools = (opts.tools ?? AGENT_TOOLS).map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));

  // Separate system prompt from messages
  let systemPrompt = '';
  const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];

  for (const m of opts.messages) {
    if (m.role === 'system') {
      systemPrompt = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      continue;
    }

    if (m.role === 'tool') {
      anthropicMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.tool_call_id,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          },
        ],
      });
      continue;
    }

    if (m.role === 'assistant') {
      const contentParts: Array<{ type: string; [key: string]: unknown }> = [];
      if (m.reasoning_content) {
        contentParts.push({ type: 'thinking', thinking: m.reasoning_content, signature: '' });
      }
      if (m.content) {
        contentParts.push({ type: 'text', text: m.content });
      }
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          contentParts.push({
            type: 'tool_use',
            id: tc.id || `tool_${tc.function.name}`,
            name: tc.function.name,
            input: tc.function.arguments,
          });
        }
      }
      anthropicMessages.push({
        role: 'assistant',
        content: contentParts.length > 0 ? contentParts : (m.content || ''),
      });
      continue;
    }

    // User message (support images / multimodal)
    if (Array.isArray(m.images) && m.images.length > 0) {
      const parts: Array<{ type: string; [key: string]: unknown }> = [];
      for (const img of m.images) {
        parts.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: img,
          },
        });
      }
      parts.push({ type: 'text', text: m.content || '' });
      anthropicMessages.push({ role: 'user', content: parts });
    } else {
      anthropicMessages.push({ role: 'user', content: m.content || '' });
    }
  }

  const payload: Record<string, unknown> = {
    model,
    max_tokens: opts.thinking && model.includes('claude-3-7') ? 8192 : 4096,
    messages: anthropicMessages,
    ...(tools.length > 0 ? { tools } : {}),
  };

  if (opts.thinking && model.includes('claude-3-7')) {
    payload.thinking = {
      type: 'enabled',
      budget_tokens: 2048,
    };
  }

  if (systemPrompt) {
    payload.system = systemPrompt;
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(new Error('LLM Request Timeout')), 120_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutController.signal]) : timeoutController.signal;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey.trim(),
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Anthropic API error (${res.status}): ${errorText || res.statusText}`);
    }

    const data = await res.json() as {
      content?: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      usage?: { output_tokens?: number };
    };

    let contentText = '';
    let thinkingText = '';
    let toolCall: ToolCall | undefined;

    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text' && block.text) {
          contentText += block.text;
        } else if (block.type === 'thinking' && block.thinking) {
          thinkingText += block.thinking;
        } else if (block.type === 'tool_use' && block.name) {
          toolCall = {
            name: block.name as AgentActionName,
            arguments: block.input ?? {},
            id: block.id,
          };
        }
      }
    }

    if (opts.onUpdate && (contentText || thinkingText)) {
      opts.onUpdate({ content: contentText, thinking: thinkingText || undefined });
    }

    return {
      content: contentText,
      thinking: thinkingText || undefined,
      toolCall,
      toolCallSource: toolCall ? 'native' : undefined,
      model,
      totalMs: Date.now() - startedAt,
      evalCount: data.usage?.output_tokens,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
