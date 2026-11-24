import { describe, expect, it, vi } from 'vitest';
import { confirmFromEvidence, newSaveEntry, reconcileSave, runJournaledSave } from './save-journal';
import type { A11yNode, A11ySnapshot, AgentTask } from './types';

const box = { bbox: { x: 0, y: 0, w: 10, h: 10 }, inViewport: true };
const click = { name: 'click' as const, arguments: { ref: '@save' } };

function form(title = 'Broken printer on floor 3'): A11ySnapshot {
  const shared = { ...box, formRef: '@form' };
  return {
    url: 'https://desk.example.test/requests/new', title: 'New request', documentStart: 1, takenAt: 1, domHash: 'a',
    viewport: { w: 100, h: 100, scrollX: 0, scrollY: 0 },
    nodes: [
      { ...shared, ref: '@title', role: 'textbox', name: 'Subject', value: title },
      { ...shared, ref: '@save', role: 'button', name: 'Submit' },
    ],
  };
}

function page(url: string, nodes: Partial<A11yNode>[], documentStart = 2): A11ySnapshot {
  return { ...form(), url, documentStart, nodes: nodes.map((n, i) => ({ ...box, ref: `@n${i}`, role: 'generic', name: '', ...n })) };
}

function task(): AgentTask {
  return { id: 't1', goal: 'file a request', tabId: 1, status: 'running', steps: [], createdAt: 0, updatedAt: 0 } as unknown as AgentTask;
}

describe('save journal', () => {
  it('persists intent before the click and leaves the entry pending when the run dies mid-submit', async () => {
    const t = task();
    const persisted: string[] = [];
    const persist = vi.fn(async (x: AgentTask) => { persisted.push(x.saveJournal!.map(e => e.status).join()); });
    const entry = newSaveEntry(1, form(), click);
    await expect(runJournaledSave(t, entry, new Set(), persist, async () => { throw new Error('service worker restarted'); }))
      .rejects.toThrow('restarted');
    expect(persisted).toEqual(['pending']);
    expect(t.saveJournal?.[0].status).toBe('pending');
  });

  it('blocks every new submission after a restart until the pending one is resolved', async () => {
    const t = task();
    const restored = newSaveEntry(1, form(), click);
    t.saveJournal = [restored];
    const execute = vi.fn();
    await expect(runJournaledSave(t, newSaveEntry(1, form(), click), new Set([restored]), async () => {}, execute))
      .rejects.toThrow('confirm_submission');
    expect(execute).not.toHaveBeenCalled();
  });

  it('confirms a create flow that redirects to the new record with a confirmation notice', () => {
    const entry = newSaveEntry(1, form(), click);
    const after = page('https://desk.example.test/requests/42', [{ role: 'status', name: 'Заявка создана' }]);
    reconcileSave(entry, after);
    expect(entry.status).toBe('confirmed');
  });

  it('keeps a redirect without any confirmation pending', () => {
    const entry = newSaveEntry(1, form(), click);
    reconcileSave(entry, page('https://desk.example.test/requests', [{ role: 'heading', name: 'Requests' }]));
    expect(entry.status).toBe('pending');
  });

  it('confirms from a record on the page only when it shows a submitted value', () => {
    const entry = newSaveEntry(1, form(), click);
    const list = page('https://desk.example.test/requests', [
      { role: 'link', name: 'Wi-Fi is down' },
      { role: 'link', name: '#42 Broken printer on floor 3' },
      { role: 'textbox', name: 'Search', value: 'Broken printer on floor 3' },
    ]);
    expect(confirmFromEvidence([entry], list, '@n0')).toHaveProperty('error');
    expect(confirmFromEvidence([entry], list, '@n2')).toHaveProperty('error');
    expect(confirmFromEvidence([entry], list, '@n1')).toMatchObject({ entry, evidence: 'Broken printer on floor 3' });
  });

  it('rejects a short shared value from an older record and two different records with the same subject', () => {
    const multi = form();
    multi.nodes.push({ ...box, ref: '@category', role: 'combobox', name: 'Category', value: 'Hardware', formRef: '@form' });
    const entry = newSaveEntry(1, multi, click);
    const older = page('https://desk.example.test/requests', [{ role: 'link', name: '#41 Monitor flickers — Hardware' }]);
    expect(confirmFromEvidence([entry], older, '@n0')).toHaveProperty('error');
    const twice = page('https://desk.example.test/requests', [
      { role: 'link', name: '#41 Broken printer on floor 3' },
      { role: 'link', name: '#42 Broken printer on floor 3' },
    ]);
    expect(confirmFromEvidence([entry], twice, '@n1')).toHaveProperty('error');
    const detail = page('https://desk.example.test/requests/42', [
      { role: 'heading', name: 'Broken printer on floor 3' },
      { role: 'link', name: 'Broken printer on floor 3' },
    ]);
    expect(confirmFromEvidence([entry], detail, '@n0')).toMatchObject({ evidence: 'Broken printer on floor 3' });
  });

  it('accepts confirmation notices that carry the new record number', () => {
    for (const notice of ['Заявка №42 создана', 'Ticket #123 has been created']) {
      const entry = newSaveEntry(1, form(), click);
      reconcileSave(entry, page('https://desk.example.test/requests/42', [{ role: 'status', name: notice }]));
      expect(entry.status, notice).toBe('confirmed');
    }
  });

  it('does not accept the unsent draft in the original editor as evidence', () => {
    const entry = newSaveEntry(1, form(), click);
    const editor = form();
    editor.nodes.push({ ...box, ref: '@preview', role: 'generic', name: 'Preview: Broken printer on floor 3', formRef: '@form' });
    expect(confirmFromEvidence([entry], editor, '@preview')).toHaveProperty('error');
  });

  it('refuses to repeat a submission that a previous run already confirmed', async () => {
    const t = task();
    const restored = newSaveEntry(1, form(), click);
    restored.status = 'confirmed';
    t.saveJournal = [restored];
    const execute = vi.fn();
    await expect(runJournaledSave(t, newSaveEntry(1, form(), click), new Set([restored]), async () => {}, execute))
      .rejects.toThrow('already confirmed');
    expect(execute).not.toHaveBeenCalled();
  });

  it('allows a resubmission once the pending entry is rejected, replacing it', async () => {
    const t = task();
    const restored = newSaveEntry(1, form(), click);
    restored.status = 'rejected';
    t.saveJournal = [restored];
    const next = newSaveEntry(1, form(), click);
    await runJournaledSave(t, next, new Set([restored]), async () => {}, async () => ({ ok: true, durationMs: 1, save: { status: 'saved' } }));
    expect(t.saveJournal).toEqual([next]);
    expect(next.status).toBe('confirmed');
  });
});
