import { describe, expect, it } from 'vitest';
import { parseBatchActions, validateBatchCall } from './batch-actions';
import type { A11ySnapshot, ToolCall } from './types';

function batch(actions: unknown[]): ToolCall {
  return { name: 'batch_actions', arguments: { actions } };
}

const snapshot: Pick<A11ySnapshot, 'nodes'> = {
  nodes: [
    { ref: '@e1', role: 'textbox', name: 'First name', bbox: { x: 0, y: 0, w: 10, h: 10 }, inViewport: true },
    { ref: '@e2', role: 'combobox', name: 'Country', bbox: { x: 0, y: 20, w: 10, h: 10 }, inViewport: true },
    { ref: '@e3', role: 'link', name: 'Continue', href: '/next', bbox: { x: 0, y: 40, w: 10, h: 10 }, inViewport: true },
    { ref: '@e4', role: 'button', name: 'Delete account', bbox: { x: 0, y: 60, w: 10, h: 10 }, inViewport: true },
  ],
};

describe('batch actions policy', () => {
  it('parses flat and nested action argument shapes', () => {
    const call = batch([
      { name: 'type', ref: '@e1', text: 'Ada' },
      { name: 'select', arguments: { ref: '@e2', value: 'UK' } },
    ]);

    expect(validateBatchCall(call, snapshot)).toBeUndefined();
    expect(parseBatchActions(call)).toEqual([
      { name: 'type', arguments: { ref: '@e1', text: 'Ada' } },
      { name: 'select', arguments: { ref: '@e2', value: 'UK' } },
    ]);
  });

  it('rejects navigation-like clicks and confirmation-sensitive controls', () => {
    expect(validateBatchCall(batch([
      { name: 'click', ref: '@e3' },
      { name: 'type', ref: '@e1', text: 'Ada' },
    ]), snapshot)).toContain('links and navigation-like targets');

    expect(validateBatchCall(batch([
      { name: 'click', ref: '@e4' },
      { name: 'type', ref: '@e1', text: 'Ada' },
    ]), snapshot, ['delete'])).toContain('confirmation-sensitive');
  });

  it('rejects submission, Enter, invalid sizes, and cross-frame batches', () => {
    expect(validateBatchCall(batch([
      { name: 'type', ref: '@e1', text: 'Ada', submit: 'true' },
      { name: 'select', ref: '@e2', value: 'UK' },
    ]), snapshot)).toContain('cannot submit');
    expect(validateBatchCall(batch([
      { name: 'press', key: 'Enter' },
      { name: 'select', ref: '@e2', value: 'UK' },
    ]), snapshot)).toContain('cannot press Enter');
    expect(validateBatchCall(batch([{ name: 'press', key: 'Escape' }]))).toContain('2-5');
    expect(validateBatchCall(batch([
      { name: 'type', ref: '@e1', text: 'Ada' },
      { name: 'type', ref: '@f2e1', text: 'Lovelace' },
    ]))).toContain('same frame');
  });
});
