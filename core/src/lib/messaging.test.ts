import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendToContent } from './messaging';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendToContent', () => {
  it('addresses the main frame so a hidden service iframe cannot answer first', async () => {
    // Without an explicit frameId, chrome delivers to every frame and resolves with whichever
    // replies first — on Gmail that is a 0x0 cookie-rotation iframe, not the inbox.
    const sendMessage = vi.fn().mockResolvedValue({ kind: 'ack' });
    vi.stubGlobal('chrome', { tabs: { sendMessage } });

    await sendToContent(42, { kind: 'som:clear' });

    expect(sendMessage).toHaveBeenCalledWith(42, { kind: 'som:clear' }, { frameId: 0 });
  });

  it('keeps the requested frame when one is named', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ kind: 'ack' });
    vi.stubGlobal('chrome', { tabs: { sendMessage } });

    await sendToContent(42, { kind: 'som:clear' }, 7);

    expect(sendMessage).toHaveBeenCalledWith(42, { kind: 'som:clear' }, { frameId: 7 });
  });

  it('gives up on a content script that is present but never answers', async () => {
    // The regression this guards: a text/plain API response left the page in a state where the
    // snapshot request never came back, and one benchmark run sat on it for 314 of its 600
    // seconds. A missing receiver rejects on its own; a silent one has nothing to reject.
    vi.useFakeTimers();
    try {
      vi.stubGlobal('chrome', { tabs: { sendMessage: vi.fn(() => new Promise(() => {})) } });

      const pending = sendToContent(42, { kind: 'a11y:snapshot' } as never);
      const settled = expect(pending).rejects.toThrow(/did not answer/);
      await vi.advanceTimersByTimeAsync(30_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not time out a slow but successful reply', async () => {
    vi.useFakeTimers();
    try {
      const sendMessage = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({ kind: 'ack' }), 20_000)));
      vi.stubGlobal('chrome', { tabs: { sendMessage } });

      const pending = sendToContent(42, { kind: 'som:clear' });
      await vi.advanceTimersByTimeAsync(20_000);

      await expect(pending).resolves.toEqual({ kind: 'ack' });
    } finally {
      vi.useRealTimers();
    }
  });
});
