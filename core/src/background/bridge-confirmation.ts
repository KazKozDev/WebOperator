/** Resolve a bridge confirmation without approving absent or malformed decisions. */
export function confirmBridgeTask(payload: Record<string, unknown>, pendingConfirms: ReadonlyMap<string, { resolve: (approve: boolean) => void }>) {
  const id = String(payload.id ?? '');
  if (!id) throw new Error('Missing task id');
  const approve = payload.approve ?? payload.allow;
  if (typeof approve !== 'boolean') throw new Error('approve must be a boolean');
  if (payload.approve !== undefined && payload.allow !== undefined && payload.approve !== payload.allow) throw new Error('approve and allow disagree');
  const pending = pendingConfirms.get(id);
  if (!pending) throw new Error(`Task ${id} is not awaiting confirmation`);
  pending.resolve(approve);
  return { ok: true, status: approve ? 'running' : 'failed' };
}
