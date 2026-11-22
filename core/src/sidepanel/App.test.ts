import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

async function loadRenderer() {
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: (path: string) => path,
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  });
  return import('./App');
}

describe('side panel startup', () => {
  it('renders navigation, starter prompts and the task input before loading settings', async () => {
    const { App } = await loadRenderer();

    const html = renderToStaticMarkup(createElement(App));

    expect(html).toContain('WebOperator');
    expect(html).toContain('Settings');
    expect(html).toContain('Summarize the current page');
    expect(html).toContain('<textarea');
    expect(html).toContain('aria-label="Improve task prompt"');
    expect(html.indexOf('aria-label="Attach file"')).toBeLessThan(html.indexOf('aria-label="Improve task prompt"'));
  });
});

describe('renderMarkdown', () => {
  it('does not allow markdown link URLs to break out of href attributes', async () => {
    const { renderMarkdown } = await loadRenderer();

    const html = renderMarkdown('[click](https://example.com" onmouseover="alert(1))');

    expect(html).not.toContain('<a ');
    expect(html).not.toContain('onmouseover');
    expect(html).toContain('click');
  });

  it('does not render javascript URLs as clickable links', async () => {
    const { renderMarkdown } = await loadRenderer();

    const html = renderMarkdown('[click](javascript:alert(1))');

    expect(html).not.toContain('<a ');
    expect(html).toContain('click');
    expect(html).not.toContain('javascript:');
  });

  it('renders safe http links with noopener and noreferrer', async () => {
    const { renderMarkdown } = await loadRenderer();

    const html = renderMarkdown('[site](https://example.com/path?q=1)');

    expect(html).toContain('<a href="https://example.com/path?q=1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('escapes markdown link labels before rendering safe links', async () => {
    const { renderMarkdown } = await loadRenderer();

    const html = renderMarkdown('[<script>alert(1)</script>](https://example.com)');

    expect(html).toContain('>link</a>');
    expect(html).not.toContain('<script>');
  });

  it('keeps asterisks inside inline code out of the emphasis passes', async () => {
    const { renderMarkdown } = await loadRenderer();

    const html = renderMarkdown('restart it with `OLLAMA_ORIGINS="http://localhost:*,http://127.0.0.1:*"`.');

    expect(html).toContain('<code>OLLAMA_ORIGINS="http://localhost:*,http://127.0.0.1:*"</code>');
    expect(html).not.toContain('<em>');
  });

  it('keeps ordered list content in a single grid cell', async () => {
    const { renderMarkdown } = await loadRenderer();

    const html = renderMarkdown('1. **Euronews**: Опубликован видео выпуск');

    expect(html).toContain('<span class="answer-list-index">1.</span><span class="answer-list-body"><strong>Euronews</strong>: Опубликован видео выпуск</span>');
  });

  it('renders markdown tables as fitted tables', async () => {
    const { renderMarkdown } = await loadRenderer();

    const html = renderMarkdown(`
| Дата | Событие |
| --- | --- |
| 19 мая | Новости Испании |
`);

    expect(html).toContain('<div class="answer-table-fit"><table>');
    expect(html).toContain('<th>Дата</th>');
    expect(html).toContain('<td>Новости Испании</td>');
    expect(html).not.toContain('| --- | --- |');
  });

  it('keeps markdown table cell content escaped and link-safe', async () => {
    const { renderMarkdown } = await loadRenderer();

    const html = renderMarkdown(`
| Name | Link |
| --- | --- |
| <script>alert(1)</script> | [bad](javascript:alert) |
`);

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<td>bad</td>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
  });
});


describe('answer link labels', () => {
  it('hides Markdown labels and bare URLs behind link, preserving destinations', async () => {
    const { renderMarkdown } = await loadRenderer();
    const html = renderMarkdown('[Source](https://example.com/a) and https://example.com/b?x=1&y=2.');
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('href="https://example.com/b?x=1&amp;y=2"');
    expect(html.match(/>link<\/a>/g)).toHaveLength(2);
    expect(html).not.toContain('Source');
    expect(html).toContain('</a>.');
  });

  it('keeps literal URLs inside code intact', async () => {
    const { renderMarkdown } = await loadRenderer();
    expect(renderMarkdown('`https://example.com/a`')).toBe('<code>https://example.com/a</code>');
  });
});
