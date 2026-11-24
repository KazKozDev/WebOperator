import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatDeepSeek, chatOpenAI, chatOpenAICompatible, chatOpenRouter } from './openai-client';
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

  describe('provider options', () => {
    const history: OllamaChatOptions = {
      url: '',
      model: 'ignored',
      images: ['abc'],
      messages: [
        { role: 'assistant', content: 'thinking done', reasoning_content: 'why' },
        { role: 'user', content: 'look at this' },
      ],
    };

    function captureRequest() {
      const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      return () => {
        const init = fetchMock.mock.calls[0][1];
        return { headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
      };
    }

    it('OpenAI keeps images and does not echo reasoning_content', async () => {
      const request = captureRequest();
      await chatOpenAI(history, 'key', 'gpt-x');
      const { body, headers } = request();
      expect(body.messages[0]).toEqual({ role: 'assistant', content: 'thinking done' });
      expect(body.messages[1].content[1].type).toBe('image_url');
      expect(headers['X-Title']).toBeUndefined();
    });

    it('OpenRouter sends attribution headers and echoes reasoning_content', async () => {
      const request = captureRequest();
      await chatOpenRouter(history, 'key', 'm');
      const { body, headers } = request();
      expect(headers['X-Title']).toBe('WebOperator');
      expect(body.messages[0].reasoning_content).toBe('why');
    });

    it('DeepSeek drops images', async () => {
      const request = captureRequest();
      await chatDeepSeek(history, 'key', 'deepseek-chat');
      expect(request().body.messages[1]).toEqual({ role: 'user', content: 'look at this' });
    });
  });
});
