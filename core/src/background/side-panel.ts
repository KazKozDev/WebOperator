// A distinct URL replaces panel views retained by the browser across reloads.
const PANEL_PATH = 'src/sidepanel/index.html?surface=sidepanel';

export function registerSidePanel(): void {
  const report = (error: unknown) => console.error('[sidepanel] Could not open or configure panel', error);

  chrome.action.onClicked.addListener((tab) => {
    if (tab.windowId === undefined) return;
    // Keep this call synchronous with the action gesture: awaiting storage or
    // setOptions here can lose the browser's permission to open the panel.
    void chrome.sidePanel.open({ windowId: tab.windowId }).catch(report);
  });

  void chrome.sidePanel.setOptions({ path: PANEL_PATH, enabled: true }).catch(report);
  // The action listener owns opening; the browser must not also toggle it.
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(report);
}
