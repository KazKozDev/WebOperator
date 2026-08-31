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
});
