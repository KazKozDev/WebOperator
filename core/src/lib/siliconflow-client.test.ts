import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatSiliconFlow } from './siliconflow-client';
import type { OllamaChatOptions } from './ollama-client';

const baseOpts: OllamaChatOptions = {
  url: '',
  model: 'ignored',
  messages: [{ role: 'user', content: 'click the result' }],
};

function okResponse() {
  return new Response(JSON.stringify({
    model: 'Qwen/Qwen3',
    choices: [{ message: { tool_calls: [{ id: 'c1', function: { name: 'click', arguments: { ref: '@e1' } } }] } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function rateLimited(retryAfter?: string) {
  return new Response(JSON.stringify({ message: 'TPM limit reached' }), {
    status: 429,
    headers: retryAfter ? { 'retry-after': retryAfter } : {},
  });
}

describe('chatSiliconFlow retry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('retries transient 429s with backoff and then succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const promise = chatSiliconFlow(baseOpts, 'key', 'Qwen/Qwen3');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.toolCall?.name).toBe('click');
  });

  it('honours the Retry-After header', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(rateLimited('2'))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const promise = chatSiliconFlow(baseOpts, 'key', 'Qwen/Qwen3');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(fetchMock).toHaveBeenCalledTimes(1); // still waiting out the 2s Retry-After
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.toolCall?.name).toBe('click');
  });

  it('gives up after exhausting retries and surfaces the error', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(rateLimited());
    vi.stubGlobal('fetch', fetchMock);

    const promise = chatSiliconFlow(baseOpts, 'key', 'Qwen/Qwen3');
    const assertion = expect(promise).rejects.toThrow(/SiliconFlow 429/);
    await vi.runAllTimersAsync();
    await assertion;

    // initial attempt + 4 retries
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('does not retry non-retriable errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad request', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(chatSiliconFlow(baseOpts, 'key', 'Qwen/Qwen3')).rejects.toThrow(/SiliconFlow 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
