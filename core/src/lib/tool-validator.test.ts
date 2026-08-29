import { describe, expect, it } from 'vitest';
import { validateAndClassifyToolCall } from './tool-validator';
import type { ToolCall } from './types';

describe('Tool Validator', () => {
  it('validates set_task_plan correctly', () => {
    const valid: ToolCall = {
      name: 'set_task_plan',
      arguments: { steps: '1. Step 1\n2. Step 2', reason: 'Goal' },
    };
    const result = validateAndClassifyToolCall(valid);
    expect(result.valid).toBe(true);
    expect(result.riskLevel).toBe('safe');
  });

  it('rejects click with missing ref', () => {
    const invalid: ToolCall = {
      name: 'click',
      arguments: {},
    };
    const result = validateAndClassifyToolCall(invalid);
    expect(result.valid).toBe(false);
  });

  it('flags risky keywords as high risk requiring confirmation', () => {
    const risky: ToolCall = {
      name: 'type',
      arguments: { ref: '@e2', text: 'Please delete my account', submit: 'true' },
    };
    const result = validateAndClassifyToolCall(risky);
    expect(result.valid).toBe(true);
    expect(result.riskLevel).toBe('high');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('validates navigation URLs and rejects non-http protocols', () => {
    const validNav: ToolCall = {
      name: 'navigate',
      arguments: { url: 'https://example.com' },
    };
    expect(validateAndClassifyToolCall(validNav).valid).toBe(true);

    const invalidNav: ToolCall = {
      name: 'navigate',
      arguments: { url: 'javascript:alert(1)' },
    };
    expect(validateAndClassifyToolCall(invalidNav).valid).toBe(false);
  });
});
