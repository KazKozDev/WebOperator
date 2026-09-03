import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeOllamaUrl, ollamaOriginsValue, ping, resolveNumCtx, chat } from './ollama-client';

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

  it('resolves num_ctx to a floor that fits a screenshot step, and honours an explicit request', () => {
    expect(resolveNumCtx()).toBe(16384);
    expect(resolveNumCtx(32768)).toBe(32768);
    // 0 is the "unset" setting value, and anything below the floor is unusable for one
    // screenshot-bearing step, so both fall back rather than being sent as asked.
    expect(resolveNumCtx(0)).toBe(16384);
    expect(resolveNumCtx(2048)).toBe(16384);
  });

  it('names the concrete extension origin in the 403 hint, never a wildcard', () => {
    // A wildcard is the one value that cannot work: Ollama accepts `chrome-extension://*` into
    // OLLAMA_ORIGINS and then still answers 403, so suggesting it repeats the error.
    vi.stubGlobal('chrome', { runtime: { id: 'phbohkmfojcjbmgfnaikenmgemgckdpg' } });
    expect(ollamaOriginsValue()).toContain('chrome-extension://phbohkmfojcjbmgfnaikenmgemgckdpg');
    expect(ollamaOriginsValue()).not.toContain('chrome-extension://*');

    vi.unstubAllGlobals();
    // Off a page — the eval harness, a unit test — there is no id to name, so the value stays a
    // placeholder the user can fill rather than a wildcard they would paste verbatim.
    expect(ollamaOriginsValue()).not.toContain('chrome-extension://*');
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

  it('retries without the thinking flag when the model rejects it, then remembers', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      if (body.think === true) {
        return new Response(JSON.stringify({ error: '"no-think-model" does not support thinking' }), { status: 400 });
      }
      return new Response(JSON.stringify({ message: { content: 'ok' }, model: 'no-think-model' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await chat({ url: 'http://127.0.0.1:11434', model: 'no-think-model', messages: [], thinking: true });
    expect(first.content).toBe('ok');
    expect(bodies.map((body) => body.think)).toEqual([true, false]);

    // The rejection is remembered, so the next call asks for no thinking up front.
    await chat({ url: 'http://127.0.0.1:11434', model: 'no-think-model', messages: [], thinking: true });
    expect(bodies.map((body) => body.think)).toEqual([true, false, false]);
  });

  it('keeps a 400 that is not about thinking as an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('model not found', { status: 400 })));

    await expect(
      chat({ url: 'http://127.0.0.1:11434', model: 'missing-model', messages: [], thinking: true }),
    ).rejects.toThrow(/Ollama 400: model not found/);
  });

  it('never sends the thinking flag when the caller did not ask for it', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ message: { content: 'ok' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    await chat({ url: 'http://127.0.0.1:11434', model: 'plain-model', messages: [] });
    expect(bodies).toHaveLength(1);
    expect(bodies[0].think).toBe(false);
  });

  it('drops images when the model rejects multimodal input', async () => {
    const bodies: Array<{ think: boolean; messages: Array<{ images?: string[] }> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      if (body.messages.some((m: { images?: string[] }) => m.images?.length)) {
        return new Response(JSON.stringify({ error: 'Multimodal data provided, but model does not support multimodal requests.' }), { status: 400 });
      }
      return new Response(JSON.stringify({ message: { content: 'ok' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    const result = await chat({
      url: 'http://127.0.0.1:11434',
      model: 'text-only-model',
      messages: [{ role: 'user', content: 'what is on screen' }],
      images: ['BASE64'],
    });

    expect(result.content).toBe('ok');
    expect(bodies).toHaveLength(2);
    expect(bodies[0].messages[0].images).toEqual(['BASE64']);
    expect(bodies[1].messages[0].images).toBeUndefined();
  });

  it('sheds thinking and images in turn for a model that supports neither', async () => {
    const attempts: Array<{ think: boolean; hasImages: boolean }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const hasImages = body.messages.some((m: { images?: string[] }) => m.images?.length);
      attempts.push({ think: body.think, hasImages });
      if (body.think) {
        return new Response(JSON.stringify({ error: '"plain" does not support thinking' }), { status: 400 });
      }
      if (hasImages) {
        return new Response(JSON.stringify({ error: 'model does not support multimodal requests' }), { status: 400 });
      }
      return new Response(JSON.stringify({ message: { content: 'ok' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    const result = await chat({
      url: 'http://127.0.0.1:11434',
      model: 'plain',
      messages: [{ role: 'user', content: 'go' }],
      thinking: true,
      images: ['BASE64'],
    });

    expect(result.content).toBe('ok');
    expect(attempts).toEqual([
      { think: true, hasImages: true },
      { think: false, hasImages: true },
      { think: false, hasImages: false },
    ]);
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
