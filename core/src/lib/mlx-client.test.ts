import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatMlx } from './mlx-client';

const OK = { status: 200, headers: { 'content-type': 'application/json' } };

function reply(message: Record<string, unknown>) {
  return vi.fn(async () => new Response(JSON.stringify({ choices: [{ message }] }), OK));
}

describe('mlx-client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('caps output length so one step fits the request timeout', async () => {
    // Without this the server applies its own 2048 default, which an 8B cannot finish
    // inside the 120s abort — the step hangs instead of answering.
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), OK);
    }));

    await chatMlx({ url: '', model: 'm', messages: [] }, '', 'm');
    expect(bodies[0].max_tokens).toBe(1024);
  });

  it('passes the thinking policy through, defaulting it off', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), OK);
    }));

    await chatMlx({ url: '', model: 'm', messages: [], thinking: true }, '', 'm');
    await chatMlx({ url: '', model: 'm', messages: [] }, '', 'm');
    expect(bodies.map((b) => b.enable_thinking)).toEqual([true, false]);
  });

  it('reads a native tool call from tool_calls', async () => {
    vi.stubGlobal('fetch', reply({
      content: '',
      tool_calls: [{ id: 'call_1', function: { name: 'done', arguments: '{"success":true}' } }],
    }));

    const res = await chatMlx({ url: '', model: 'm', messages: [] }, '', 'm');
    expect(res.toolCall?.name).toBe('done');
    expect(res.toolCall?.arguments).toEqual({ success: true });
    expect(res.toolCallSource).toBe('native');
  });

  // mlx-vlm serving Qwen3-VL routinely returns the call as plain text with tool_calls empty.
  // Before the fallback this failed the step outright, after a wasted repair round-trip.
  it('recovers a tool call the model wrote into the content', async () => {
    vi.stubGlobal('fetch', reply({
      content: '{"name": "done", "arguments": {"success": true, "summary": "clear, 18C"}}',
    }));

    const res = await chatMlx({ url: '', model: 'm', messages: [] }, '', 'm');
    expect(res.toolCall?.name).toBe('done');
    expect(res.toolCall?.arguments).toEqual({ success: true, summary: 'clear, 18C' });
    expect(res.toolCallSource).toBe('content');
  });

  it('recovers a tool call wrapped in a json code fence', async () => {
    vi.stubGlobal('fetch', reply({
      content: '```json\n{"name": "type", "arguments": {"ref": "@e12", "text": "hi"}}\n```',
    }));

    const res = await chatMlx({ url: '', model: 'm', messages: [] }, '', 'm');
    expect(res.toolCall?.name).toBe('type');
    expect(res.toolCallSource).toBe('content');
  });

  it('leaves prose alone rather than inventing a call', async () => {
    vi.stubGlobal('fetch', reply({ content: 'I should click the search box next.' }));

    const res = await chatMlx({ url: '', model: 'm', messages: [] }, '', 'm');
    expect(res.toolCall).toBeUndefined();
    expect(res.toolCallSource).toBeUndefined();
  });

  it('ignores JSON that is not one of the agent tools', async () => {
    vi.stubGlobal('fetch', reply({ content: '{"name": "not_a_tool", "arguments": {}}' }));

    const res = await chatMlx({ url: '', model: 'm', messages: [] }, '', 'm');
    expect(res.toolCall).toBeUndefined();
  });
});
