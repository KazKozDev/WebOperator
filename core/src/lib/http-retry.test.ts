import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, isRetriableStatus, parseRetryAfterMs } from './http-retry';

describe('isRetriableStatus', () => {
  it('treats 429 and transient 5xx as retriable', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isRetriableStatus(status)).toBe(true);
    }
  });

  it('treats success and client errors as non-retriable', () => {
    for (const status of [200, 400, 401, 403, 404, 501]) {
      expect(isRetriableStatus(status)).toBe(false);
    }
  });
});

describe('parseRetryAfterMs', () => {
  it('parses delay-seconds form', () => {
    expect(parseRetryAfterMs('3')).toBe(3000);
  });

  it('parses HTTP-date form relative to now', () => {
    const ms = parseRetryAfterMs(new Date(Date.now() + 5000).toUTCString());
    expect(ms).toBeGreaterThan(3000);
    expect(ms).toBeLessThanOrEqual(5000);
  });

  it('returns undefined for missing or invalid headers', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs('not-a-date')).toBeUndefined();
  });
});

describe('fetchWithRetry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('retries retriable statuses then returns the success response', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchWithRetry('https://x.test', { method: 'POST' }, new AbortController().signal);
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns the last response (undrained) after exhausting retries', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async () => new Response('still limited', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchWithRetry('https://x.test', { method: 'POST' }, new AbortController().signal);
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(429);
    expect(await res.text()).toBe('still limited'); // body still readable for the caller's error message
    expect(fetchMock).toHaveBeenCalledTimes(5); // initial + 4 retries
  });

  it('does not retry non-retriable statuses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithRetry('https://x.test', { method: 'POST' }, new AbortController().signal);
    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts the backoff wait when the signal fires', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(new Response('limited', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchWithRetry('https://x.test', { method: 'POST' }, controller.signal);
    const rejection = expect(promise).rejects.toBeTruthy();
    controller.abort(new Error('stopped'));
    await rejection;
  });
});
