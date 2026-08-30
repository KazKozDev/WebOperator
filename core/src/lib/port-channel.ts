/**
 * Bidirectional typed Port channel between Side Panel and Background Service Worker.
 * Follows the Claude Extension pattern for resilient streaming and keep-alive.
 */

import type { SWEvent, SWMessage } from './types';

export const PORT_CHANNEL_NAME = 'weboperator-agent-port';

export type PortInboundMessage =
  | { kind: 'ping'; timestamp: number }
  | { kind: 'session:attach'; tabId?: number }
  | { kind: 'sw:message'; message: SWMessage };

export type PortOutboundMessage =
  | { type: 'pong'; timestamp: number }
  | { type: 'sw:event'; event: SWEvent }
  | { type: 'sw:response'; correlationId?: string; result?: unknown; error?: string };

export type PortEventListener = (event: SWEvent) => void;

/**
 * Client-side port controller for Side Panel UI.
 */
export class AgentPortClient {
  private port: chrome.runtime.Port | null = null;
  private listeners = new Set<PortEventListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private isDisposed = false;

  constructor(private tabIdGetter?: () => number | undefined) {
    this.connect();
  }

  public connect(): void {
    if (this.isDisposed) return;
    if (typeof chrome === 'undefined' || !chrome.runtime?.connect) {
      return;
    }
    if (this.port) {
      try { this.port.disconnect(); } catch {}
      this.port = null;
    }

    try {
      this.port = chrome.runtime.connect({ name: PORT_CHANNEL_NAME });
      
      this.port.onMessage.addListener((msg: PortOutboundMessage) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'sw:event' && msg.event) {
          for (const listener of this.listeners) {
            try { listener(msg.event); } catch (err) { console.error('[AgentPortClient] listener error', err); }
          }
        }
      });

      this.port.onDisconnect.addListener(() => {
        this.port = null;
        this.stopPing();
        if (!this.isDisposed) {
          this.scheduleReconnect();
        }
      });

      // Send initial attach
      const tabId = this.tabIdGetter?.();
      this.postMessage({ kind: 'session:attach', tabId });

      this.startPing();
    } catch (err) {
      console.warn('[AgentPortClient] Failed to connect, retrying...', err);
      this.scheduleReconnect();
    }
  }

  public subscribe(listener: PortEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public postMessage(msg: PortInboundMessage): void {
    if (this.port) {
      try {
        this.port.postMessage(msg);
      } catch (err) {
        console.warn('[AgentPortClient] Post message failed, reconnecting', err);
        this.connect();
      }
    }
  }

  public dispose(): void {
    this.isDisposed = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.port) {
      try { this.port.disconnect(); } catch {}
      this.port = null;
    }
    this.listeners.clear();
  }

  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      this.postMessage({ kind: 'ping', timestamp: Date.now() });
    }, 20_000); // 20s keep-alive
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isDisposed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1000);
  }
}

/**
 * Host-side port controller for Service Worker.
 */
export class AgentPortHost {
  private ports = new Set<chrome.runtime.Port>();
  private messageHandlers = new Set<(msg: PortInboundMessage, port: chrome.runtime.Port) => void>();

  constructor() {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onConnect) {
      chrome.runtime.onConnect.addListener((port) => {
        if (port.name !== PORT_CHANNEL_NAME) return;
        this.ports.add(port);

        port.onMessage.addListener((msg: PortInboundMessage) => {
          if (msg?.kind === 'ping') {
            try {
              port.postMessage({ type: 'pong', timestamp: Date.now() } satisfies PortOutboundMessage);
            } catch {}
            return;
          }

          for (const handler of this.messageHandlers) {
            try { handler(msg, port); } catch (err) { console.error('[AgentPortHost] handler error', err); }
          }
        });

        port.onDisconnect.addListener(() => {
          this.ports.delete(port);
        });
      });
    }
  }

  public onMessage(handler: (msg: PortInboundMessage, port: chrome.runtime.Port) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  public broadcastEvent(event: SWEvent): void {
    const payload: PortOutboundMessage = { type: 'sw:event', event };
    for (const port of this.ports) {
      try {
        port.postMessage(payload);
      } catch {
        this.ports.delete(port);
      }
    }
  }

  public get activePortCount(): number {
    return this.ports.size;
  }
}
