import { describe, expect, it, vi } from 'vitest';
import { AgentPortClient, AgentPortHost, PORT_CHANNEL_NAME } from './port-channel';
import type { SWEvent } from './types';

describe('Port Channel', () => {
  it('instantiates AgentPortHost and registers connect listener', () => {
    const addListener = vi.fn();
    (globalThis as any).chrome = {
      runtime: {
        onConnect: {
          addListener,
        },
      },
    };

    const host = new AgentPortHost();
    expect(addListener).toHaveBeenCalledOnce();
    expect(host.activePortCount).toBe(0);
  });

  it('broadcasts events to active ports in AgentPortHost', () => {
    let connectHandler: ((port: unknown) => void) | undefined;
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        onConnect: {
          addListener: (fn: (port: unknown) => void) => { connectHandler = fn; },
        },
      },
    };

    const host = new AgentPortHost();
    const mockPostMessage = vi.fn();
    const mockPort = {
      name: PORT_CHANNEL_NAME,
      postMessage: mockPostMessage,
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
    };

    if (connectHandler) {
      connectHandler(mockPort);
    }
    expect(host.activePortCount).toBe(1);

    const testEvent: SWEvent = {
      kind: 'task:update',
      task: {
        id: 'test-123',
        goal: 'test goal',
        status: 'running',
        profile: 'balanced',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tabId: 1,
        steps: [],
      },
    };

    host.broadcastEvent(testEvent);
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'sw:event',
      event: testEvent,
    });
  });


  it('AgentPortClient connects with the standard channel name', () => {
    const mockConnect = vi.fn().mockReturnValue({
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    });

    (globalThis as any).chrome = {
      runtime: {
        connect: mockConnect,
      },
    };

    const client = new AgentPortClient(() => 42);
    expect(mockConnect).toHaveBeenCalledWith({ name: PORT_CHANNEL_NAME });

    client.dispose();
  });
});
