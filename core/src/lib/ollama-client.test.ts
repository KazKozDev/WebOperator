import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeOllamaUrl, ping, resolveNumCtx, chat } from './ollama-client';

describe('ollama-client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes URLs without protocol to http://', () => {
    expect(normalizeOllamaUrl('localhost:11434')).toBe('http://localhost:11434');
    expect(normalizeOllamaUrl('127.0.0.1:11434/')).toBe('http://127.0.0.1:11434');
    expect(normalizeOllamaUrl('https://my-ollama.example.com/')).toBe('https://my-ollama.example.com');
    expect(normalizeOllamaUrl('')).toBe('');
  });

  it('resolves num_ctx appropriately based on model and settings', () => {
    expect(resolveNumCtx('qwen2.5-coder:7b')).toBe(16384);
    expect(resolveNumCtx('llama3.3:70b')).toBe(16384);
    expect(resolveNumCtx('deepseek-r1:14b')).toBe(16384);
    expect(resolveNumCtx('custom-small')).toBe(8192);
    expect(resolveNumCtx('custom-small', 32768)).toBe(32768);
  });

  it('returns ok: false without throwing when ping is given an unsupported scheme/model string', async () => {
    const result = await ping('glm-5.3-flash:cloud');
    expect(result.ok).toBe(false);
    expect(result.models).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it('handles empty or whitespace url gracefully in ping', async () => {
    const result = await ping('   ');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('parses models correctly when fetch returns 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      models: [{ name: 'llama3:latest' }, { name: 'qwen2.5:latest' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    const result = await ping('http://127.0.0.1:11434');
    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['llama3:latest', 'qwen2.5:latest']);
  });

  it('separates <think> tags from content during chat', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      model: 'deepseek-r1:14b',
      message: {
        content: '<think>Let me click the search bar.</think>```json\n{"name":"click","arguments":{"ref":"@e2"}}\n```',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    const result = await chat({
      url: 'http://127.0.0.1:11434',
      model: 'deepseek-r1:14b',
      messages: [{ role: 'user', content: 'Search' }],
    });

    expect(result.thinking).toBe('Let me click the search bar.');
    expect(result.toolCall).toEqual({
      name: 'click',
      arguments: { ref: '@e2' },
    });
  });

  it('omits tool schemas for text-only calls', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      model: 'test-model',
      message: { content: 'summary' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await chat({
      url: 'http://127.0.0.1:11434',
      model: 'test-model',
      messages: [{ role: 'user', content: 'Summarize' }],
      tools: [],
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).not.toHaveProperty('tools');
  });
});
