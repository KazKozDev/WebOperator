import { afterEach, expect, it, vi } from 'vitest';
import { registerSidePanel } from './side-panel';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup() {
  let click: (tab: Partial<chrome.tabs.Tab>) => void = () => {};
  const sidePanel = {
    open: vi.fn().mockResolvedValue(undefined),
    setOptions: vi.fn().mockResolvedValue(undefined),
    setPanelBehavior: vi.fn().mockResolvedValue(undefined),
  };
  vi.stubGlobal('chrome', {
    action: { onClicked: { addListener: (listener: typeof click) => { click = listener; } } },
    sidePanel,
  });
  return { sidePanel, click: (tab: Partial<chrome.tabs.Tab>) => click(tab) };
}

it('opens the window panel from the click even while configuration is pending', () => {
  const { sidePanel, click } = setup();
  sidePanel.setOptions.mockReturnValue(new Promise(() => {}));
  registerSidePanel();

  click({ id: 42, windowId: 7 });

  expect(sidePanel.open).toHaveBeenCalledExactlyOnceWith({ windowId: 7 });
  expect(sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: false });
});

it('assigns the existing local page a distinct panel URL without disabling it', () => {
  const { sidePanel } = setup();
  registerSidePanel();
  const options = sidePanel.setOptions.mock.calls[0][0];
  const url = new URL(options.path, 'https://extension.test/');
  expect(url.pathname).toBe('/src/sidepanel/index.html');
  expect(url.searchParams.get('surface')).toBe('sidepanel');
  expect(options.enabled).toBe(true);
  expect(options).not.toHaveProperty('tabId');
});

it('does not invent a window or repeatedly retry a rejected open', async () => {
  const { sidePanel, click } = setup();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  sidePanel.open.mockRejectedValue(new Error('Panel unavailable'));
  registerSidePanel();
  click({ id: 42 });
  expect(sidePanel.open).not.toHaveBeenCalled();

  click({ windowId: 7 });
  await Promise.resolve();

  expect(sidePanel.open).toHaveBeenCalledOnce();
  expect(log).toHaveBeenCalledWith(expect.stringContaining('[sidepanel]'), expect.objectContaining({ message: 'Panel unavailable' }));
});
