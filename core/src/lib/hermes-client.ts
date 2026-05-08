// ── Hermes Tool Bridge ──
// WebOperator exposes browser capabilities as tools for Hermes Agent.
// Hermes calls WebOperator, not the other way around.

export interface HermesToolRequest {
  tool: string;
  arguments: Record<string, unknown>;
}

export interface HermesToolResult {
  ok: boolean;
  error?: string;
  data?: unknown;
}

/**
 * Register WebOperator as a tool for Hermes.
 * Returns the tool manifest that Hermes can discover.
 */
export function getWebOperatorToolManifest() {
  return {
    name: 'weboperator',
    description: 'Browser automation via Chrome — navigate, click, type, screenshot, extract page data.',
    tools: [
      {
        name: 'weboperator.snapshot',
        description: 'Take an accessibility snapshot of the current page. Returns structured page content with element refs.',
        parameters: {},
      },
      {
        name: 'weboperator.screenshot',
        description: 'Take a screenshot of the current page viewport.',
        parameters: {},
      },
      {
        name: 'weboperator.navigate',
        description: 'Navigate to a URL.',
        parameters: { url: 'string' },
      },
      {
        name: 'weboperator.click',
        description: 'Click an element by its ref ID from the snapshot.',
        parameters: { ref: 'string' },
      },
      {
        name: 'weboperator.type',
        description: 'Type text into an input field by its ref ID.',
        parameters: { ref: 'string', text: 'string' },
      },
      {
        name: 'weboperator.scroll',
        description: 'Scroll the page.',
        parameters: { direction: "'up' | 'down'", amount: 'number' },
      },
      {
        name: 'weboperator.extract',
        description: 'Extract structured data from the current page snapshot.',
        parameters: {},
      },
      {
        name: 'weboperator.press',
        description: 'Press a keyboard key.',
        parameters: { key: 'string' },
      },
    ],
  };
}
