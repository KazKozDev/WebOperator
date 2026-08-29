// Shared retry policy for LLM provider HTTP calls.
//
// 429 (TPM/rate limit) and transient 5xx clear on their own — retrying with
// backoff is the correct response. Hammering immediately keeps the key
// throttled, so we wait (honouring Retry-After) before each retry.

const MAX_REQUEST_RETRIES = 4;
const RETRY_BASE_MS = 1_000;
const RETRY_CAP_MS = 20_000;

export function isRetriableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason ?? new Error('Aborted')); return; }
    const onAbort = () => { clearTimeout(timer); reject(signal.reason ?? new Error('Aborted')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// Issues the request and transparently retries retriable failures with
// exponential backoff + jitter. The returned Response is left undrained so the
// caller can read the body (including on the final, still-failing attempt).
export async function fetchWithRetry(input: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(input, { ...init, signal });
    if (res.ok || !isRetriableStatus(res.status) || attempt >= MAX_REQUEST_RETRIES) return res;
    // Drain the body so the connection can be reused before we back off.
    await res.text().catch(() => '');
    const retryAfter = parseRetryAfterMs(res.headers.get('retry-after'));
    const backoff = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt);
    await sleep((retryAfter ?? backoff) + Math.floor(Math.random() * 250), signal);
  }
}
