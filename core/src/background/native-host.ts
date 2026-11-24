export type NativeHost = (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** One request to a local service of the native bridge (csv, mcp, numbers). */
export function requestNative(port: chrome.runtime.Port | null, service: string, payload: Record<string, unknown>, timeoutMs = 30000): Promise<Record<string, unknown>> {
  if (!port) return Promise.reject(new Error(`This tool requires the WebOperator native bridge (${service})`));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    function cleanup() {
      clearTimeout(timer);
      port!.onMessage.removeListener(receive);
      port!.onDisconnect.removeListener(disconnect);
    }
    function disconnect() { cleanup(); reject(new Error(`Native bridge disconnected during ${service} request`)); }
    function receive(msg: { kind?: string; id?: string; result?: Record<string, unknown>; error?: string }) {
      if (msg.kind !== `${service}:response` || msg.id !== id) return;
      cleanup();
      if (msg.error || !msg.result) reject(new Error(msg.error ?? `Missing ${service} result`));
      else resolve(msg.result);
    }
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Native bridge timed out on ${service}`)); }, timeoutMs);
    port.onMessage.addListener(receive);
    port.onDisconnect.addListener(disconnect);
    try { port.postMessage({ kind: `${service}:request`, id, payload }); }
    catch (error) { cleanup(); reject(error); }
  });
}
