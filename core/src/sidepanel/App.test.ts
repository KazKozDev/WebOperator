import { describe, expect, it, vi } from 'vitest';

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

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
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
