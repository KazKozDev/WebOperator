import { matchesReopenedForm, saveOutcome } from './form-save';
import { maskCallForLog } from './masking';
import type { A11ySnapshot, ActionResult, AgentTask, ToolCall } from './types';

export interface SaveEntry {
  tabId: number;
  before: A11ySnapshot;
  args: Record<string, unknown>;
  status: 'pending' | 'confirmed' | 'rejected';
  leftRecord: boolean;
}

function target(snapshot: A11ySnapshot, ref: unknown) {
  return snapshot.nodes.find(n => ref ? n.ref === ref : n.state?.includes('focused'));
}

function formValues(entry: SaveEntry) {
  const node = target(entry.before, entry.args.ref);
  return entry.before.nodes.filter(n => n.formRef === node?.formRef && n.frameId === node?.frameId &&
    ['textbox', 'searchbox', 'combobox', 'checkbox', 'radio'].includes(n.role)).map(n => {
    const expected = n === node && typeof entry.args.text === 'string'
      ? (entry.args.mode === 'append' ? n.value ?? '' : '') + entry.args.text : n.value;
    return [n.role, n.name, expected, n.state?.includes('checked')];
  });
}

const EDITABLE = new Set(['textbox', 'searchbox', 'combobox']);

/** Text values the entry submitted, longest first; only these can identify the stored record. */
export function submittedValues(entry: SaveEntry): string[] {
  const formless = !target(entry.before, entry.args.ref)?.formRef;
  return formValues(entry)
    // Without a <form>, every formless input in the frame is collected. A site search box is not part of the record.
    .filter(([role, name, value]) => EDITABLE.has(String(role)) && typeof value === 'string' &&
      !(formless && (role === 'searchbox' || /search|поиск|buscar/i.test(String(name)))))
    .map(([, , value]) => String(value).trim())
    .filter(value => value.length >= 3 && !value.includes('••'))
    .sort((a, b) => b.length - a.length);
}

/** Field names and values, for the model to know which record to look for. */
export function describeSubmission(entry: SaveEntry): string {
  const fields = formValues(entry)
    .filter(([role, name, value]) => EDITABLE.has(String(role)) && name && typeof value === 'string' && value.trim())
    .map(([, name, value]) => `${name}=${JSON.stringify(String(value).slice(0, 80))}`);
  return `${entry.status}: ${entry.before.url}${fields.length ? ` (${fields.join(', ')})` : ''}`;
}

/**
 * Confirm a pending entry from what the page shows now: a non-editable node that
 * contains a value the entry submitted. The model cannot confirm by assertion alone.
 */
export function confirmFromEvidence(entries: SaveEntry[], snapshot: A11ySnapshot, ref: string): { entry: SaveEntry; evidence: string } | { error: string } {
  const pending = entries.filter(entry => entry.status === 'pending');
  if (!pending.length) return { error: 'No unconfirmed submission to resolve.' };
  const node = snapshot.nodes.find(n => n.ref === ref);
  if (!node) return { error: `Element ${ref} is not in the current snapshot.` };
  if (EDITABLE.has(node.role) || node.state?.includes('editable')) {
    return { error: 'An input still holds the draft. Point to the stored record, such as a heading, row or detail text.' };
  }
  const text = `${node.name} ${node.text ?? ''} ${node.value ?? ''}`.toLowerCase().replace(/\s+/g, ' ');
  for (const entry of [...pending].reverse()) {
    // The original editor still shows the typed values. Only another document or form counts.
    const sameEditor = snapshot.documentStart === entry.before.documentStart && snapshot.url === entry.before.url &&
      node.formRef && node.formRef === target(entry.before, entry.args.ref)?.formRef;
    if (sameEditor) continue;
    // A short shared value such as a category also appears on older records. Only the
    // longest value, or a long one, shown by exactly one record on the page identifies this one.
    const values = submittedValues(entry);
    const evidence = values.filter((value, i) => i === 0 || value.length >= 12).find(value => {
      const needle = value.toLowerCase().replace(/\s+/g, ' ');
      // A heading and a breadcrumb with the same text name one record; "#41 …" and "#42 …" are two.
      const holders = new Set(snapshot.nodes.filter(n => !EDITABLE.has(n.role) && !n.state?.includes('editable'))
        .map(n => `${n.name} ${n.text ?? ''} ${n.value ?? ''}`.toLowerCase().replace(/\s+/g, ' ').trim())
        .filter(content => content.includes(needle)));
      return text.includes(needle) && holders.size === 1;
    });
    if (evidence) return { entry, evidence };
  }
  return { error: `Element ${ref} does not show a submitted value. Look for: ${pending.map(describeSubmission).join(' | ')}` };
}

export function newSaveEntry(tabId: number, snapshot: A11ySnapshot, call: ToolCall): SaveEntry {
  const args = maskCallForLog(call, snapshot).arguments;
  const ref = target(snapshot, args.ref)?.ref;
  return { tabId, before: snapshot, args: { ref, ...(call.name === 'type' ? { text: args.text, mode: args.mode } : {}) },
    status: 'pending', leftRecord: false };
}

export function reconcileSave(entry: SaveEntry, snapshot: A11ySnapshot): boolean {
  if (entry.status !== 'pending') return false;
  const changedPage = snapshot.url !== entry.before.url;
  const departed = changedPage && !entry.leftRecord;
  if (departed) entry.leftRecord = true;
  if (new URL(snapshot.url).origin !== new URL(entry.before.url).origin) return departed;
  const outcome = saveOutcome(entry.before, snapshot, entry.args.ref);
  if (outcome.status === 'rejected') entry.status = 'rejected';
  if (outcome.status === 'saved' || (outcome.status === 'unconfirmed' && matchesReopenedForm(entry.before, snapshot, entry.args, entry.leftRecord))) {
    entry.status = 'confirmed';
  }
  return departed || entry.status !== 'pending';
}

// Persist intent before invoking any browser operation. A disconnect or throw
// after dispatch deliberately leaves an uncertain entry for the next run.
export async function runJournaledSave(task: AgentTask, entry: SaveEntry, restored: ReadonlySet<SaveEntry>,
  persist: (task: AgentTask) => Promise<void>, execute: () => Promise<ActionResult>): Promise<ActionResult> {
  const entries = task.saveJournal ??= [];
  const sameForm = (old: SaveEntry) => {
    const oldTarget = target(old.before, old.args.ref);
    const nextTarget = target(entry.before, entry.args.ref);
    return old.before.url === entry.before.url && (oldTarget?.formRef === nextTarget?.formRef ||
      JSON.stringify(formValues(old).map(v => v.slice(0, 2))) === JSON.stringify(formValues(entry).map(v => v.slice(0, 2))));
  };
  if (entries.some(old => old.status === 'pending' && (restored.has(old) || sameForm(old)))) {
    throw new Error('Previous submission is unconfirmed. Find the stored record and call confirm_submission before submitting again.');
  }
  if (entries.some(old => restored.has(old) && old.status === 'confirmed' && sameForm(old) &&
    JSON.stringify(formValues(old)) === JSON.stringify(formValues(entry)))) {
    throw new Error('This submission was already confirmed. Continue with the next task step.');
  }
  task.saveJournal = [...entries.filter(old => !(old.status === 'rejected' && sameForm(old))), entry];
  try { await persist(task); }
  catch (error) { task.saveJournal = entries; throw error; }
  const result = await execute();
  if (result.save?.status === 'saved') entry.status = 'confirmed';
  else if (result.save?.status === 'rejected' || result.delivery === 'not-sent') entry.status = 'rejected';
  await persist(task);
  return result;
}
