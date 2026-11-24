import { sendToContent } from '@/lib/messaging';
import { saveOutcome } from '@/lib/form-save';
import type { ActionResult, CSMessage, SaveOutcome, ToolCall } from '@/lib/types';

export async function observeFormAction(tabId: number, frameId: number, call: ToolCall, execute: () => Promise<ActionResult>): Promise<ActionResult> {
  const message = (msg: CSMessage) => sendToContent(tabId, msg, frameId);
  const before = await message({ kind: 'save:context', action: call });
  if (before.kind === 'error') return { ok: false, delivery: 'not-sent', error: before.error, durationMs: 0 };
  if (before.kind !== 'save:context') return execute();

  const start = performance.now();
  let result: ActionResult;
  try {
    result = await execute();
  } catch (error) {
    // Navigation can close the original content-script port after a real submit.
    result = { ok: false, error: String(error), durationMs: performance.now() - start };
  }
  const possiblyDelivered = result.ok || /click was cancelled|message port closed|message channel closed/i.test(result.error ?? '');
  if (!possiblyDelivered) return result;
  let save: SaveOutcome = { status: 'unconfirmed' };
  let last = before.snapshot;
  for (const delay of [0, 100, 300, 600, 1000]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const after = await message({ kind: 'snapshot:take', options: { refPrefix: before.refPrefix, shadow: true, allElements: true } }).catch(() => undefined);
    if (after?.kind !== 'snapshot') continue;
    save = saveOutcome(before.snapshot, after.snapshot, before.ref);
    if (save.status === 'unconfirmed' && last !== before.snapshot && last.nodes.some(n => n.ref === before.ref)) {
      save = saveOutcome(last, after.snapshot, before.ref);
    }
    last = after.snapshot;
    if (save.status !== 'unconfirmed') break;
  }
  return { ok: save.status !== 'rejected', save, durationMs: performance.now() - start,
    ...(save.status === 'rejected' ? { error: save.message } : {}) };
}
