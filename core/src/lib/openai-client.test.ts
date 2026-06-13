import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatOpenAICompatible } from './openai-client';
import type { OllamaChatOptions } from './ollama-client';

describe('chatOpenAICompatible', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes blank tool call ids and object arguments from compatible providers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      model: 'gemini-2.5-flash',
      choices: [{
        message: {
          tool_calls: [{
            id: '',
            function: {
              name: 'click',
              arguments: { ref: '@e1', reason: 'open result' },
            },
          }],
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    const opts: OllamaChatOptions = {
      url: '',
      model: 'ignored',
      messages: [{ role: 'user', content: 'click the result' }],
    };

    const result = await chatOpenAICompatible({
      opts,
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
      label: 'Gemini',
      url: 'https://example.test/chat/completions',
    });

    expect(result.toolCall?.name).toBe('click');
    expect(result.toolCall?.arguments).toEqual({ ref: '@e1', reason: 'open result' });
    expect(result.toolCall?.id).toMatch(/^call_click_\d+$/);
  });
});
