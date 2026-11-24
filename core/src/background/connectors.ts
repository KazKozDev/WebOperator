import { fenceUntrusted, newFenceNonce } from '@/lib/injection-guard';
import type { AgentTask, ToolCall } from '@/lib/types';
import type { NativeHost } from './native-host';

export interface ConnectorCallEntry {
  server: string;
  tool: string;
  args: string;
  status: 'pending' | 'done' | 'failed' | 'unknown';
  at: number;
}

interface ConnectorTool { name: string; description?: string; inputSchema?: unknown; readOnly?: boolean }

export interface ConnectorDeps {
  host?: NativeHost;
  /** Ask the user, through the same confirmation the browser path uses. */
  confirm: (call: ToolCall) => Promise<boolean>;
  persist: (task: AgentTask) => Promise<void>;
}

let unsupportedUntil = 0;

/** Configured connector names; an old or absent bridge just means none. */
export async function connectorServers(host?: NativeHost, timeoutMs = 3000): Promise<string[]> {
  // A bridge from before connectors never answers; don't wait for it on every task.
  if (!host || Date.now() < unsupportedUntil) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      host({ op: 'servers' }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    const servers = Array.isArray(result.servers) ? result.servers : [];
    return servers.map(item => String((item as { name?: unknown }).name ?? '')).filter(Boolean);
  } catch (error) {
    if (String(error).includes('timeout')) unsupportedUntil = Date.now() + 10 * 60_000;
    return [];
  } finally { clearTimeout(timer); }
}

function argumentsOf(call: ToolCall): Record<string, unknown> {
  const raw = call.arguments.arguments;
  if (raw === undefined || raw === '') return {};
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('call_connector arguments must be a JSON object');
  return value as Record<string, unknown>;
}

export async function runConnectorTool(task: AgentTask, call: ToolCall, deps: ConnectorDeps): Promise<{ extracted: unknown; note: string }> {
  const host = deps.host;
  if (!host) throw new Error('Connectors require the WebOperator native bridge');
  const server = typeof call.arguments.server === 'string' ? call.arguments.server : '';

  if (call.name === 'list_connectors') {
    if (!server) return { extracted: await host({ op: 'servers' }), note: 'Listed connectors' };
    const { tools } = await host({ op: 'tools', server }) as { tools: ConnectorTool[] };
    // Descriptions and schemas are written by the server.
    return { extracted: { server, tools: fenceUntrusted(JSON.stringify(tools), newFenceNonce()) }, note: `Listed ${tools.length} tools of ${server}` };
  }

  const toolName = typeof call.arguments.tool === 'string' ? call.arguments.tool : '';
  if (!server || !toolName) throw new Error('call_connector needs server and tool');
  const args = argumentsOf(call);
  const { tools } = await host({ op: 'tools', server }) as { tools: ConnectorTool[] };
  const tool = tools.find(item => item.name === toolName);
  if (!tool) throw new Error(`Connector ${server} has no tool ${toolName}. Call list_connectors with server=${server}.`);

  const journal = task.connectorJournal ?? [];
  // A pending entry here comes from a run that died during the call: it may have happened.
  const earlier = journal.find(entry => entry.status === 'pending' && entry.server === server && entry.tool === toolName);
  if (!tool.readOnly || earlier) {
    const reason = earlier ? 'An earlier call to this tool may already have run before the restart. Check before allowing.' : undefined;
    const allowed = await deps.confirm(reason ? { ...call, arguments: { ...call.arguments, reason } } : call);
    if (!allowed) throw new Error('The user declined this connector call. Do not retry it; continue without it or finish with success=false.');
    if (earlier) earlier.status = 'unknown';
  }

  let entry: ConnectorCallEntry | undefined;
  if (!tool.readOnly) {
    entry = { server, tool: toolName, args: JSON.stringify(args).slice(0, 2000), status: 'pending', at: Date.now() };
    (task.connectorJournal ??= []).push(entry);
    await deps.persist(task);
  }
  let result: { isError?: boolean; text?: string; truncated?: boolean; otherContent?: string[] };
  try {
    result = await host({ op: 'call', server, tool: toolName, arguments: args });
  } catch (error) {
    // After dispatch the outcome is unknown; the entry stays pending so a repeat asks first.
    if (entry) await deps.persist(task);
    throw error;
  }
  if (entry) { entry.status = result.isError ? 'failed' : 'done'; await deps.persist(task); }
  const body = `${result.text ?? ''}${result.truncated ? '\n[truncated]' : ''}${result.otherContent?.length ? `\n[non-text content: ${result.otherContent.join(', ')}]` : ''}`;
  const extracted = { server, tool: toolName, isError: result.isError === true, output: fenceUntrusted(body, newFenceNonce()) };
  return { extracted, note: `${server}.${toolName} ${result.isError ? 'returned an error' : 'ok'}` };
}
