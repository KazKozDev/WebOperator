import { describe, expect, it } from 'vitest';
import { summarizeExtraction } from './extraction';

describe('summarizeExtraction', () => {
  it('counts items that carry text, a value, or a link', () => {
    const summary = summarizeExtraction([
      { ref: '@e1', text: 'Invoice from Acme' },
      { ref: '@e2', text: '', value: 'artem@example.com' },
      { ref: '@e3', text: '', href: 'https://example.com/thread/1' },
    ]);

    expect(summary.hasData).toBe(true);
    expect(summary.itemCount).toBe(3);
  });

  it('reports no data when the tool returns zero items', () => {
    const summary = summarizeExtraction([]);

    expect(summary.hasData).toBe(false);
    expect(summary.itemCount).toBe(0);
    expect(summary.reason).toContain('zero items');
  });

  it('reports no data when every returned ref came back empty', () => {
    const summary = summarizeExtraction([{ ref: '@e1', text: '' }, { ref: '@e2', text: '   ' }]);

    expect(summary.hasData).toBe(false);
    expect(summary.reason).toContain('all 2 returned items were empty');
  });

  it('rejects a short body-text fallback as the interstitial placeholder it is', () => {
    const summary = summarizeExtraction([{ ref: 'document.body', text: 'init(...)' }]);

    expect(summary.hasData).toBe(false);
    expect(summary.reason).toContain('body-text fallback');
  });

  it('rejects any body-text fallback that came from a page with no accessibility tree', () => {
    // Gmail's hidden cookie-rotation iframe answers with its bootstrap script and nothing else.
    const payload = [{ ref: 'document.body', text: "init('-4984232896288535446', 23.0 , 0.0 , 0.0 , 600.0 )" }];

    expect(summarizeExtraction(payload).hasData).toBe(true);
    expect(summarizeExtraction(payload, { pageIsBlank: true })).toMatchObject({
      hasData: false,
      itemCount: 0,
    });
  });

  it('accepts a body-text fallback that holds real page content', () => {
    const summary = summarizeExtraction([
      { ref: 'document.body', text: 'Inbox — 12 unread messages from the last three days, including two invoices.' },
    ]);

    expect(summary.hasData).toBe(true);
    expect(summary.itemCount).toBe(1);
  });

  it('handles missing payloads and empty strings', () => {
    expect(summarizeExtraction(undefined).hasData).toBe(false);
    expect(summarizeExtraction('   ').hasData).toBe(false);
    expect(summarizeExtraction('visible text').hasData).toBe(true);
  });

  it('summarizes spreadsheet cell payloads by non-empty row', () => {
    expect(summarizeExtraction({ range: 'A1:B2', cells: [['a', 'b'], ['', '']] })).toEqual({
      hasData: true,
      itemCount: 1,
    });
    expect(summarizeExtraction({ range: 'A1:B2', cells: [['', '']] }).hasData).toBe(false);
  });
});
