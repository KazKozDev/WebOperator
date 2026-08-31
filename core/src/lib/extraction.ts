/**
 * A read-only tool can report ok:true and still have brought back nothing usable — an empty
 * array of refs, a body-text fallback on an interstitial that only holds a script call. The
 * loop treats "the action ran" and "the data arrived" as the same thing unless something
 * separates them here, so every extract keeps looking like progress.
 */

/** Body-text fallback shorter than this is a placeholder page, not page content. */
const MIN_BODY_FALLBACK_CHARS = 40;

const BODY_FALLBACK_REF = 'document.body';

export interface ExtractionOptions {
  /**
   * The page the payload came from exposes no accessibility nodes and no text. Nothing readable
   * exists there, so a whole-body fallback is a placeholder no matter how long it is.
   */
  pageIsBlank?: boolean;
}

export interface ExtractionSummary {
  /** True when the payload carries content the task can actually use. */
  hasData: boolean;
  /** Items that carry text, a value, or an href. */
  itemCount: number;
  /** Why the payload does not count as data — worded for the model. */
  reason?: string;
}

export function summarizeExtraction(extracted: unknown, options: ExtractionOptions = {}): ExtractionSummary {
  if (extracted === undefined || extracted === null) {
    return { hasData: false, itemCount: 0, reason: 'the tool returned no payload at all' };
  }

  if (typeof extracted === 'string') {
    const text = extracted.trim();
    return text
      ? { hasData: true, itemCount: 1 }
      : { hasData: false, itemCount: 0, reason: 'the returned text was empty' };
  }

  if (Array.isArray(extracted)) {
    return summarizeItems(extracted, options);
  }

  if (typeof extracted === 'object') {
    const cells = (extracted as { cells?: unknown }).cells;
    if (Array.isArray(cells)) {
      const rows = cells.filter((row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim()));
      return rows.length > 0
        ? { hasData: true, itemCount: rows.length }
        : { hasData: false, itemCount: 0, reason: 'the range came back with no non-empty cells' };
    }
    return Object.keys(extracted as Record<string, unknown>).length > 0
      ? { hasData: true, itemCount: 1 }
      : { hasData: false, itemCount: 0, reason: 'the returned object was empty' };
  }

  return { hasData: true, itemCount: 1 };
}

function summarizeItems(items: unknown[], options: ExtractionOptions): ExtractionSummary {
  const filled = items.filter(itemHasContent);
  if (filled.length === 0) {
    return {
      hasData: false,
      itemCount: 0,
      reason: items.length === 0
        ? 'the tool returned zero items'
        : `all ${items.length} returned items were empty`,
    };
  }

  // Only the whole-body fallback came back. On a page with no accessibility tree that is a
  // placeholder — an interstitial's bootstrap script, a document caught mid-navigation — and
  // even on a normal page a fallback this short carries nothing worth reporting.
  const onlyBodyFallback = filled.every((item) => itemRef(item) === BODY_FALLBACK_REF);
  if (onlyBodyFallback) {
    const chars = filled.reduce<number>((total, item) => total + itemText(item).length, 0);
    if (options.pageIsBlank) {
      return {
        hasData: false,
        itemCount: 0,
        reason: `only a body-text fallback came back (${chars} characters) from a page that exposes no accessibility nodes, so this is placeholder text rather than page content`,
      };
    }
    if (chars < MIN_BODY_FALLBACK_CHARS) {
      return {
        hasData: false,
        itemCount: 0,
        reason: `only a ${chars}-character body-text fallback came back, so the page has no readable content yet`,
      };
    }
  }

  return { hasData: true, itemCount: filled.length };
}

function itemHasContent(item: unknown): boolean {
  if (typeof item === 'string') return item.trim().length > 0;
  if (!item || typeof item !== 'object') return false;
  const record = item as Record<string, unknown>;
  return Boolean(
    itemText(record) || String(record.value ?? '').trim() || String(record.href ?? '').trim(),
  );
}

function itemText(item: unknown): string {
  if (typeof item === 'string') return item.trim();
  if (!item || typeof item !== 'object') return '';
  return String((item as Record<string, unknown>).text ?? '').trim();
}

function itemRef(item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  return String((item as Record<string, unknown>).ref ?? '');
}
