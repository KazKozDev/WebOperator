import { describe, expect, it } from 'vitest';
import { verify, verificationToPrompt, describeVerification } from './verifier';
import type { A11yNode, A11ySnapshot } from './types';

function snapshot(overrides: Partial<A11ySnapshot> = {}): A11ySnapshot {
  return {
    url: 'https://example.com',
    title: 'Example',
    viewport: { w: 1280, h: 720, scrollX: 0, scrollY: 0 },
    nodes: [],
    domHash: 'same-dom',
    takenAt: 1,
    ...overrides,
  };
}

function node(overrides: Partial<A11yNode> = {}): A11yNode {
  return {
    ref: '@e1',
    role: 'generic',
    name: '',
    bbox: { x: 0, y: 0, w: 10, h: 10 },
    inViewport: true,
    ...overrides,
  };
}

const okAction = { ok: true, durationMs: 1 };

describe('verifier', () => {
  it('treats successful read-only extraction as success without DOM changes', () => {
    const result = verify(
      snapshot(),
      snapshot({ takenAt: 2 }),
      { ok: true, durationMs: 1, extracted: 'visible text' },
      'extract',
    );

    expect(result.status).toBe('success');
    expect(result.domChanged).toBe(false);
  });

  it('refuses to call an empty extraction a success', () => {
    const result = verify(
      snapshot({ nodes: [node()] }),
      snapshot({ nodes: [node()], takenAt: 2 }),
      { ok: true, durationMs: 1, extracted: [] },
      'extract',
    );

    expect(result.status).toBe('partial');
    expect(result.dataMissing).toContain('zero items');
    expect(result.recommendedStrategy).toBe('try_alternative');
    expect(describeVerification(result)).toContain('Verification partial (no data extracted)');
    expect(verificationToPrompt(result)).toContain('NO data was extracted');
  });

  it('tells the model to leave an interstitial instead of re-extracting', () => {
    const result = verify(
      snapshot({ url: 'https://accounts.google.com/RotateCookiesPage' }),
      snapshot({ url: 'https://accounts.google.com/RotateCookiesPage', takenAt: 2 }),
      {
        ok: true,
        durationMs: 1,
        extracted: [{ ref: 'document.body', text: "init('-4984232896288535446', 23.0 , 0.0 , 0.0 , 600.0 )" }],
      },
      'extract',
    );

    expect(result.status).toBe('partial');
    expect(result.recommendedStrategy).toBe('wait_and_retry');
    expect(result.suggestions.join(' ')).toContain('exposes no accessibility nodes');
  });

  it('counts the items a successful extraction returned', () => {
    const result = verify(
      snapshot(),
      snapshot({ takenAt: 2 }),
      { ok: true, durationMs: 1, extracted: [{ ref: '@e1', text: 'Invoice from Acme' }] },
      'extract',
    );

    expect(result.status).toBe('success');
    expect(result.itemsExtracted).toBe(1);
    expect(describeVerification(result)).toContain('1 item(s) extracted');
  });

  it('detects partial/ghost execution when click produces no DOM/URL changes', () => {
    const result = verify(
      snapshot(),
      snapshot({ takenAt: 2 }),
      { ok: true, durationMs: 1 },
      'click',
    );

    expect(result.status).toBe('partial');
    expect(result.domChanged).toBe(false);
    expect(result.urlChanged).toBe(false);
    expect(describeVerification(result)).toContain('Verification partial (no DOM/URL change)');

    const prompt = verificationToPrompt(result);
    expect(prompt).toContain('NO observable state or DOM change was detected');
  });

  it('detects success when DOM hash changes after action', () => {
    const result = verify(
      snapshot({ domHash: 'hash-1' }),
      snapshot({ domHash: 'hash-2', takenAt: 2 }),
      { ok: true, durationMs: 1 },
      'click',
    );

    expect(result.status).toBe('success');
    expect(result.domChanged).toBe(true);
    expect(verificationToPrompt(result)).toContain('Action confirmed');
  });

  it('verifies typed input by value even when the DOM hash is unchanged', () => {
    const before = snapshot({ nodes: [node({ ref: '@e2', role: 'textbox', value: '' })] });
    const after = snapshot({ takenAt: 2, nodes: [node({ ref: '@e2', role: 'textbox', value: 'hello' })] });

    const result = verify(before, after, okAction, 'type', { ref: '@e2', text: 'hello' });

    expect(result.status).toBe('success');
    expect(result.suggestions[0]).toContain('Input value matches');
  });

  it('keeps a mismatched typed value partial when nothing else changed', () => {
    const before = snapshot({ nodes: [node({ ref: '@e2', role: 'textbox', value: '' })] });
    const after = snapshot({ takenAt: 2, nodes: [node({ ref: '@e2', role: 'textbox', value: 'hel' })] });

    expect(verify(before, after, okAction, 'type', { ref: '@e2', text: 'hello' }).status).toBe('partial');
  });

  it('verifies selected values and internally checked spreadsheet actions', () => {
    const before = snapshot({ nodes: [node({ ref: '@e3', role: 'combobox', value: 'One' })] });
    const after = snapshot({ takenAt: 2, nodes: [node({ ref: '@e3', role: 'combobox', value: 'Two' })] });

    expect(verify(before, after, okAction, 'select', { ref: '@e3', value: 'Two' }).status).toBe('success');
    expect(verify(snapshot(), snapshot({ takenAt: 2 }), okAction, 'fill_cells').status).toBe('success');
  });

  it('verifies every typed or selected value in a batch', () => {
    const before = snapshot({ nodes: [
      node({ ref: '@e1', role: 'textbox', value: '' }),
      node({ ref: '@e2', role: 'combobox', value: 'One' }),
    ] });
    const after = snapshot({ takenAt: 2, nodes: [
      node({ ref: '@e1', role: 'textbox', value: 'Ada' }),
      node({ ref: '@e2', role: 'combobox', value: 'Two' }),
    ] });
    const args = { actions: [
      { name: 'type', ref: '@e1', text: 'Ada' },
      { name: 'select', ref: '@e2', value: 'Two' },
    ] };

    expect(verify(before, after, okAction, 'batch_actions', args).status).toBe('success');

    const mismatched = snapshot({ takenAt: 3, nodes: [
      node({ ref: '@e1', role: 'textbox', value: 'Ad' }),
      node({ ref: '@e2', role: 'combobox', value: 'Two' }),
    ] });
    const result = verify(before, mismatched, okAction, 'batch_actions', args);
    expect(result.status).toBe('partial');
    expect(result.suggestions[0]).toContain('tool-specific verification failed');
  });

  it('does not flag error words in pre-existing page text', () => {
    const articleSnippet = 'Common error handling mistakes developers make';
    const before = snapshot({ textSnippets: [articleSnippet] });
    const after = snapshot({
      domHash: 'new-dom',
      takenAt: 2,
      textSnippets: [articleSnippet],
    });

    const result = verify(before, after, okAction, 'click');

    expect(result.status).toBe('success');
    expect(result.errorDetected).toBeUndefined();
  });

  it('flags error text that appeared after the action', () => {
    const before = snapshot({ textSnippets: ['Sign in to continue'] });
    const after = snapshot({
      domHash: 'new-dom',
      takenAt: 2,
      textSnippets: ['Sign in to continue', 'Something went wrong, please try again'],
    });

    const result = verify(before, after, okAction, 'click');

    expect(result.status).toBe('failed');
    expect(result.errorDetected).toContain('something went wrong');
  });

  it('does not flag error words in headings that existed before the action', () => {
    const heading = node({ role: 'heading', name: 'Top 10 error messages explained' });
    const before = snapshot({ nodes: [heading] });
    const after = snapshot({ nodes: [heading], domHash: 'new-dom', takenAt: 2 });

    const result = verify(before, after, okAction, 'scroll');

    expect(result.errorDetected).toBeUndefined();
  });

  it('flags a new heading that looks like an error page', () => {
    const before = snapshot();
    const after = snapshot({
      domHash: 'new-dom',
      takenAt: 2,
      nodes: [node({ role: 'heading', name: 'Access denied' })],
    });

    const result = verify(before, after, okAction, 'navigate');

    expect(result.status).toBe('failed');
    expect(result.errorDetected).toContain('access denied');
  });

  it('flags HTTP error codes in the page title', () => {
    const result = verify(
      snapshot(),
      snapshot({ title: '503 Service Unavailable', domHash: 'new-dom', takenAt: 2 }),
      okAction,
      'navigate',
    );

    expect(result.status).toBe('failed');
    expect(result.errorDetected).toContain('503');
  });
});
