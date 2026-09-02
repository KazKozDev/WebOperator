import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatOpenAICompatibleProvider, resolveChatCompletionsUrl } from './openai-compatible-client';
import type { OllamaChatOptions } from './ollama-client';

const baseOpts: OllamaChatOptions = {
  url: '',
  model: 'ignored',
  messages: [{ role: 'user', content: 'click the result' }],
};

function okResponse() {
  return new Response(JSON.stringify({
    model: 'local-model',
    choices: [{ message: { tool_calls: [{ id: 'c1', function: { name: 'click', arguments: { ref: '@e1' } } }] } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('resolveChatCompletionsUrl', () => {
  it('appends /v1/chat/completions to a bare host', () => {
    expect(resolveChatCompletionsUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080/v1/chat/completions');
    expect(resolveChatCompletionsUrl('127.0.0.1:8080/')).toBe('http://127.0.0.1:8080/v1/chat/completions');
  });

  it('appends /chat/completions to an API root', () => {
    expect(resolveChatCompletionsUrl('http://127.0.0.1:8080/v1')).toBe('http://127.0.0.1:8080/v1/chat/completions');
    expect(resolveChatCompletionsUrl('https://api.example.com/openai/v1/')).toBe('https://api.example.com/openai/v1/chat/completions');
  });

  it('leaves a full endpoint alone', () => {
    expect(resolveChatCompletionsUrl('https://api.example.com/v1/chat/completions'))
      .toBe('https://api.example.com/v1/chat/completions');
  });

  it('rejects an empty base URL', () => {
    expect(() => resolveChatCompletionsUrl('  ')).toThrow(/base URL is empty/);
  });
});

describe('chatOpenAICompatibleProvider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends no authorization header when the key is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const result = await chatOpenAICompatibleProvider(baseOpts, 'http://127.0.0.1:8080/v1', '', 'local-model');

    expect(result.toolCall?.name).toBe('click');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8080/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('sends a bearer token when a key is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await chatOpenAICompatibleProvider(baseOpts, 'https://api.example.com/v1', 'sk-test', 'local-model');

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
  });

  it('fails before the request when no model is set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(chatOpenAICompatibleProvider(baseOpts, 'http://127.0.0.1:8080/v1', '', ' '))
      .rejects.toThrow(/model is empty/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
