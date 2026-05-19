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
});
