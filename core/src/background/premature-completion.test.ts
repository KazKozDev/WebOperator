import { describe, it, expect } from 'vitest';
import { looksLikePrematureCompletion } from './agent-loop';

describe('looksLikePrematureCompletion', () => {
  it('blocks a summary that admits the work product is unfinished', () => {
    expect(looksLikePrematureCompletion('Filled the first rows; full data entry would require visiting each listing.')).toBe(true);
    expect(looksLikePrematureCompletion('Could not fill all the cells before running out of steps.')).toBe(true);
    expect(looksLikePrematureCompletion('These are partial results — I stopped after the first page.')).toBe(true);
    expect(looksLikePrematureCompletion('The table is not complete.')).toBe(true);
    expect(looksLikePrematureCompletion('Таблица не полностью заполнена.')).toBe(true);
  });

  it('lets a finished answer through even when it describes what was left over', () => {
    // The regression this guards: an AssistantBench answer scoring 0.80 was blocked twice, and
    // then lost entirely, because the word "remaining" appeared in a sentence proving the agent
    // had in fact covered those items.
    expect(looksLikePrematureCompletion(
      'Trails come from the archived list (30 on page 1; the remaining page-2 trails were also screened).',
    )).toBe(false);
    expect(looksLikePrematureCompletion(
      'Fountain Paint Pot 4.6/5 from 379 reviews. The remaining 6 trails scored below the threshold.',
    )).toBe(false);
    expect(looksLikePrematureCompletion('Found a partial match for the street name, then confirmed the full address.')).toBe(false);
    expect(looksLikePrematureCompletion('The refund is not fully refundable within 24 hours.')).toBe(false);
    expect(looksLikePrematureCompletion('Осталось 3 места на рейс.')).toBe(false);
  });

  it('reads a negated phrase as the claim of completeness it is', () => {
    // The regression this guards: a finished answer ending "Screening is complete, with no
    // partial results outstanding" was refused eleven times in a row, because the guard matched
    // "partial results" and never looked at the "no" in front of it.
    expect(looksLikePrematureCompletion('Screening is complete, with no partial results outstanding.')).toBe(false);
    expect(looksLikePrematureCompletion('Every row is filled; there are no partial results here.')).toBe(false);
    expect(looksLikePrematureCompletion('The table is not incomplete — all 12 cells are written.')).toBe(false);
  });

  it('only trusts a negation that comes before the phrase', () => {
    // Deliberate limitation. Looking for a negator *after* the phrase as well would exempt
    // "partial results — not everything was collected", which is a genuine admission, and
    // letting those through costs more than the occasional Russian sentence that negates late.
    expect(looksLikePrematureCompletion('Готово, частичный ответ не потребовался.')).toBe(true);
  });

  it('still blocks the same phrases when they are asserted, not denied', () => {
    expect(looksLikePrematureCompletion('These are partial results; I ran out of steps.')).toBe(true);
    expect(looksLikePrematureCompletion('The sheet is not complete.')).toBe(true);
  });
});
