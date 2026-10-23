import { expect, it, vi } from 'vitest';
import { confirmBridgeTask } from './bridge-confirmation';

it('resumes an approved pending task and reports its next status', () => {
  const resolve = vi.fn();
  expect(confirmBridgeTask({ id: 'task', approve: true }, new Map([['task', { resolve }]]))).toEqual({ ok: true, status: 'running' });
  expect(resolve).toHaveBeenCalledWith(true);
});
it('rejects a pending action and supports legacy allow', () => {
  const resolve = vi.fn();
  const pending = new Map([['task', { resolve }]]);
  expect(confirmBridgeTask({ id: 'task', approve: false }, pending)).toEqual({ ok: true, status: 'failed' });
  expect(resolve).toHaveBeenCalledWith(false);
  expect(confirmBridgeTask({ id: 'task', allow: true }, pending).status).toBe('running');
});
it('never resolves missing, malformed, or contradictory approvals', () => {
  const resolve = vi.fn();
  const pending = new Map([['task', { resolve }]]);
  for (const payload of [{ id: 'task' }, { id: 'task', approve: 'true' }, { id: 'task', approve: true, allow: false }, { id: 'missing', approve: true }]) {
    expect(() => confirmBridgeTask(payload, pending)).toThrow();
  }
  expect(resolve).not.toHaveBeenCalled();
});
