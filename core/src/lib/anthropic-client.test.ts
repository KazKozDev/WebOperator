import { describe, expect, it, vi } from 'vitest';
import { chatAnthropic } from './anthropic-client';

describe('chatAnthropic', () => {
  it('throws error when api key is missing', async () => {
    await expect(
      chatAnthropic(
        { url: '', model: 'claude-3-7-sonnet-20250219', messages: [{ role: 'user', content: 'hello' }] },
        '',
        'claude-3-7-sonnet-20250219'
      )
    ).rejects.toThrow('Anthropic API key is empty');
  });

  it('formats payload correctly and returns tool call response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: 'I will click on the button.' },
          { type: 'tool_use', id: 'tool_123', name: 'click', input: { ref: '@e5', reason: 'Submit' } },
        ],
        usage: { output_tokens: 42 },
      }),
    });

    vi.stubGlobal('fetch', mockFetch);

    const result = await chatAnthropic(
      {
        url: '',
        model: 'claude-3-7-sonnet-20250219',
        messages: [
          { role: 'system', content: 'You are a browser agent.' },
          { role: 'user', content: 'Click submit' },
        ],
      },
      'sk-ant-test-key-12345',
      'claude-3-7-sonnet-20250219'
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-test-key-12345',
          'anthropic-version': '2023-06-01',
        }),
      })
    );

    expect(result.content).toBe('I will click on the button.');
    expect(result.toolCall).toEqual({
      name: 'click',
      arguments: { ref: '@e5', reason: 'Submit' },
      id: 'tool_123',
    });
    expect(result.evalCount).toBe(42);
  });

  it('parses extended thinking blocks for Claude 3.7 models', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          { type: 'thinking', thinking: 'Let me analyze the DOM structure...' },
          { type: 'tool_use', id: 'tool_999', name: 'navigate', input: { url: 'https://example.com' } },
        ],
        usage: { output_tokens: 120 },
      }),
    });

    vi.stubGlobal('fetch', mockFetch);

    const onUpdate = vi.fn();
    const result = await chatAnthropic(
      {
        url: '',
        model: 'claude-3-7-sonnet-20250219',
        thinking: true,
        onUpdate,
        messages: [{ role: 'user', content: 'Go to example.com' }],
      },
      'sk-ant-test-key-12345',
      'claude-3-7-sonnet-20250219'
    );

    expect(result.thinking).toBe('Let me analyze the DOM structure...');
    expect(result.toolCall?.name).toBe('navigate');
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      thinking: 'Let me analyze the DOM structure...',
    }));
  });
});
