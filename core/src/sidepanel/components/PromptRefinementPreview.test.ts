import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { PromptRefinementPreview } from './PromptRefinementPreview';

it('shows a reviewable draft, changes, questions and value warnings without applying it', () => {
  const apply = vi.fn();
  const html = renderToStaticMarkup(createElement(PromptRefinementPreview, {
    original: 'Find 3 cameras under 900. Do not buy.',
    result: { prompt: 'Find 3 cameras.', changes: ['Clarified the task'], questions: ['Which country?'], warnings: [] },
    disabled: false, onApply: apply, onDiscard: vi.fn(),
  }));
  expect(html).toContain('aria-label="Improved task"');
  expect(html).toContain('Which country?');
  expect(html).toContain('Original value missing or reformatted: 900');
  expect(html).toContain('Apply prompt');
  expect(html).toContain('Do not buy.');
  expect(apply).not.toHaveBeenCalled();
});

it('escapes model content and disables applying a stale preview', () => {
  const html = renderToStaticMarkup(createElement(PromptRefinementPreview, {
    original: 'Draft', result: { prompt: '<script>bad()</script>', changes: ['<img onerror=bad()>'], questions: [], warnings: [] },
    disabled: true, onApply: vi.fn(), onDiscard: vi.fn(),
  }));
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img ');
  expect(html).toContain('disabled="">Apply prompt');
});
