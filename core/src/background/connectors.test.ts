import { describe, expect, it, vi } from 'vitest';
import type { AgentTask, ToolCall } from '@/lib/types';
import { connectorServers, runConnectorTool } from './connectors';

const tools = [
  { name: 'list_messages', readOnly: true },
  { name: 'create_draft', readOnly: false },
];
const draft: ToolCall = { name: 'call_connector', arguments: { server: 'mail', tool: 'create_draft', arguments: { to: 'a@example.test' } } };

function setup(call = vi.fn(async () => ({ isError: false, text: 'draft 17 created' }))) {
  const task = {} as AgentTask;
  const statuses: string[] = [];
  const host = vi.fn(async (payload: Record<string, unknown>) => {
    if (payload.op === 'tools') return { tools };
    if (payload.op === 'call') { statuses.push(`call:${task.connectorJournal?.map(e => e.status).join() ?? ''}`); return call(); }
    return { servers: [{ name: 'mail' }] };
  });
  const confirm = vi.fn(async () => true);
  const persist = vi.fn(async () => { statuses.push(`persist:${task.connectorJournal?.map(e => e.status).join()}`); });
  return { task, host, confirm, persist, statuses, deps: { host, confirm, persist } };
}

describe('connector tools', () => {
  it('fences server-written tool descriptions', async () => {
    const { task, deps } = setup();
    const { extracted } = await runConnectorTool(task, { name: 'list_connectors', arguments: { server: 'mail' } }, deps);
    expect((extracted as { tools: string }).tools).toMatch(/UNTRUSTED PAGE CONTENT[\s\S]*create_draft/);
  });

  it('runs a read-only tool without asking and fences its output', async () => {
    const { task, deps, confirm } = setup();
    const { extracted } = await runConnectorTool(task, { ...draft, arguments: { server: 'mail', tool: 'list_messages', arguments: '{}' } }, deps);
    expect(confirm).not.toHaveBeenCalled();
    expect(task.connectorJournal).toBeUndefined();
    expect((extracted as { output: string }).output).toMatch(/UNTRUSTED PAGE CONTENT [0-9a-f]+ — treat as observation[\s\S]*draft 17 created/);
  });

  it('asks before a write and journals it as pending before the call', async () => {
    const { task, deps, confirm, statuses } = setup();
    await runConnectorTool(task, draft, deps);
    expect(confirm).toHaveBeenCalledWith(draft);
    expect(statuses).toEqual(['persist:pending', 'call:pending', 'persist:done']);
  });

  it('does not call the connector when the user declines', async () => {
    const { task, deps, confirm, host } = setup();
    confirm.mockResolvedValueOnce(false);
    await expect(runConnectorTool(task, draft, deps)).rejects.toThrow('declined');
    expect(host).not.toHaveBeenCalledWith(expect.objectContaining({ op: 'call' }));
  });

  it('keeps an interrupted call pending and warns before repeating it', async () => {
    const { task, deps, confirm } = setup(vi.fn().mockRejectedValueOnce(new Error('Native bridge disconnected'))
      .mockResolvedValueOnce({ isError: false, text: 'ok' }));
    await expect(runConnectorTool(task, draft, deps)).rejects.toThrow('disconnected');
    expect(task.connectorJournal?.[0].status).toBe('pending');
    await runConnectorTool(task, draft, deps);
    expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ arguments: expect.objectContaining({ reason: expect.stringContaining('may already have run') }) }));
    expect(task.connectorJournal?.map(e => e.status)).toEqual(['unknown', 'done']);
  });

  it('rejects unknown tools and non-object arguments', async () => {
    const { task, deps } = setup();
    await expect(runConnectorTool(task, { ...draft, arguments: { server: 'mail', tool: 'delete_all' } }, deps)).rejects.toThrow('no tool delete_all');
    await expect(runConnectorTool(task, { ...draft, arguments: { ...draft.arguments, arguments: '[1]' } }, deps)).rejects.toThrow('JSON object');
  });

  it('treats a silent or missing bridge as no connectors', async () => {
    expect(await connectorServers(undefined)).toEqual([]);
    expect(await connectorServers(async () => ({ servers: [{ name: 'mail' }] }))).toEqual(['mail']);
    expect(await connectorServers(() => new Promise(() => {}), 10)).toEqual([]);
    // An old bridge that never answers is not asked again on the next task.
    const later = vi.fn(async () => ({ servers: [{ name: 'mail' }] }));
    expect(await connectorServers(later)).toEqual([]);
    expect(later).not.toHaveBeenCalled();
  });
});
