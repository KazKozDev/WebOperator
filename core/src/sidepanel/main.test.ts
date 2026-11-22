import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { render, createRoot } = vi.hoisted(() => {
  const render = vi.fn();
  return { render, createRoot: vi.fn(() => ({ render })) };
});
vi.mock('react-dom/client', () => ({ createRoot }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  render.mockClear();
  createRoot.mockClear();
});

describe('side panel bootstrap', () => {
  it('shows a loading status before JavaScript starts', () => {
    const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
    expect(html).toContain('<p role="status">Loading WebOperator…</p>');
  });

  it('renders the app once its module loads', async () => {
    vi.doMock('./App', () => ({ App: () => null }));
    vi.stubGlobal('document', { getElementById: () => ({}) });

    await import('./main');

    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
  });

  it('shows an error and a working retry when the app module fails', async () => {
    vi.doMock('./App', () => ({ get App() { throw new Error('Module failed'); } }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = { replaceChildren: vi.fn() };
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    vi.stubGlobal('document', {
      getElementById: () => root,
      createElement: () => ({ style: {}, addEventListener: vi.fn() }),
    });

    await import('./main');

    await vi.waitFor(() => expect(root.replaceChildren).toHaveBeenCalledOnce());
    const [message, detail, retry] = root.replaceChildren.mock.calls[0];
    expect(message.role).toBe('alert');
    expect(message.textContent).toContain('could not load');
    expect(detail.textContent).toBe('Module failed');
    retry.addEventListener.mock.calls[0][1]();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('shows React render failures instead of leaving the root blank', async () => {
    vi.doMock('./App', () => ({ App: () => null }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = { replaceChildren: vi.fn() };
    vi.stubGlobal('document', {
      getElementById: () => root,
      createElement: () => ({ style: {}, addEventListener: vi.fn() }),
    });
    await import('./main');
    await vi.waitFor(() => expect(createRoot).toHaveBeenCalledOnce());
    const options = (createRoot.mock.calls[0] as unknown as [unknown, { onUncaughtError: (error: Error) => void }])[1];

    options.onUncaughtError(new Error('Render failed'));

    expect(root.replaceChildren).toHaveBeenCalledOnce();
    expect(root.replaceChildren.mock.calls[0][1].textContent).toBe('Render failed');
  });
});
