import type { AgentActionName, A11ySnapshot } from './types';

export interface OllamaToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description: string;
        enum?: string[];
        items?: {
          type: string;
          properties: Record<string, { type: string; description: string; enum?: string[] }>;
          required: string[];
        };
      }>;
      required: string[];
    };
  };
}

export const AGENT_TOOLS: OllamaToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'set_task_plan',
      description: 'Set a compact visible task plan before browser actions. Use 2-5 concise action steps (3-8 words each).',
      parameters: {
        type: 'object',
        properties: {
          steps: { type: 'string', description: 'Numbered action steps, one per line. Example: "1. Search query\\n2. Open target page\\n3. Extract data"' },
          reason: { type: 'string', description: 'one short sentence (under 15 words) explaining intent' },
        },
        required: ['steps', 'reason'],
      },

    },
  },
  {
    type: 'function',
    function: {
      name: 'batch_actions',
      description: 'Execute 2-5 independent, non-navigating actions in order with one verification snapshot. Stops at the first failure. Only use within the current plan step. Never batch links, submission, Enter, destructive actions, or actions whose targets depend on an earlier action.',
      parameters: {
        type: 'object',
        properties: {
          actions: {
            type: 'array',
            description: 'Ordered safe actions. Allowed names: click, type, press, select.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'click|type|press|select', enum: ['click', 'type', 'press', 'select'] },
                ref: { type: 'string', description: 'element ref from the current snapshot; optional only for press' },
                text: { type: 'string', description: 'text for type' },
                mode: { type: 'string', description: 'replace|append for type', enum: ['replace', 'append'] },
                key: { type: 'string', description: 'non-submitting key for press; Enter is forbidden' },
                modifiers: { type: 'string', description: 'comma-separated modifiers for press' },
                value: { type: 'string', description: 'option value or visible text for select' },
              },
              required: ['name'],
            },
          },
          reason: { type: 'string', description: 'short reason these actions are independent and safe to batch' },
        },
        required: ['actions'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click',
      description: 'Click an interactive element by its ref (e.g. "@e3").',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'element ref from a11y snapshot, like @eN' },
          reason: { type: 'string', description: 'short reason — why this click' },
        },
        required: ['ref'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type',
      description: 'Type text into an input field (textbox/searchbox/combobox/contenteditable). Default replaces content; mode=append adds at the end/current position. submit=true to press Enter after.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'input field ref' },
          text: { type: 'string', description: 'text to type' },
          mode: { type: 'string', description: 'replace|append; replace by default', enum: ['replace', 'append'] },
          submit: { type: 'string', description: '"true" to press Enter after typing, otherwise "false"' },
        },
        required: ['ref', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'press',
      description: 'Press a key or shortcut in the active element. Useful for editors: Enter, Backspace, Cmd/Ctrl+B, Cmd/Ctrl+I, Cmd/Ctrl+U.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'key: Enter, Backspace, Escape, Tab, B, I, U, etc.' },
          modifiers: { type: 'string', description: 'comma-separated modifiers: meta,ctrl,shift,alt. On macOS for Cmd use meta.' },
          ref: { type: 'string', description: 'optional: ref of element to focus first' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'select',
      description: 'Select an option in a select/combobox by ref and value or text.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'dropdown ref' },
          value: { type: 'string', description: 'value or visible text of the option' },
        },
        required: ['ref', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scroll',
      description: 'Scroll the page or an element.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', description: 'up|down|top|bottom|to_ref', enum: ['up', 'down', 'top', 'bottom', 'to_ref'] },
          ref: { type: 'string', description: 'element ref if direction=to_ref' },
          amountPx: { type: 'number', description: 'pixels to scroll (if direction up/down)' },
        },
        required: ['direction'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Navigate to a URL in the current tab.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'absolute URL' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait',
      description: 'Wait for a condition: page load, element appearance, or timeout.',
      parameters: {
        type: 'object',
        properties: {
          ms: { type: 'number', description: 'timeout in milliseconds (max 10000)' },
          until: { type: 'string', description: 'load|network_idle|element|none', enum: ['load', 'network_idle', 'element', 'none'] },
          ref: { type: 'string', description: 'element ref if until=element' },
        },
        required: ['ms'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'extract',
      description: 'Extract data from the page and return to the user as a partial result. Pass comma-separated refs of interactive elements, refs="visible" for visible page text, or refs="all" for document.body.',
      parameters: {
        type: 'object',
        properties: {
          refs: { type: 'string', description: 'comma-separated refs, or "visible", or "all"' },
          note: { type: 'string', description: 'explanation — what is being extracted' },
        },
        required: ['refs'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'done',
      description: 'Finish the task. success=true if completed, otherwise false with explanation.',
      parameters: {
        type: 'object',
        properties: {
          success: { type: 'string', description: '"true" or "false"' },
          summary: { type: 'string', description: 'CRITICAL: Must contain the FULL, unsummarized result. If extracting a list of items, list EVERY SINGLE ITEM. Do not use "etc" or truncate.' },
        },
        required: ['success', 'summary'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_tab',
      description: 'Open exactly one URL in a new browser tab. Use one open_tab call per URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'absolute URL to open in a new tab' },
          reason: { type: 'string', description: 'short reason for opening this tab' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'switch_tab',
      description: 'Switch focus to an existing browser tab by tabId.',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'number', description: 'tab id returned by open_tab or list_tabs' },
          reason: { type: 'string', description: 'short reason for switching to this tab' },
        },
        required: ['tabId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tabs',
      description: 'List open browser tabs with tabId, title, URL, active state, pinned state, index, and groupId. Use before organizing or switching to existing tabs.',
      parameters: {
        type: 'object',
        properties: {
          currentWindow: { type: 'string', description: '"true" to list only current window tabs; "false" to list all windows. Default true.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'close_tabs',
      description: 'Close one or more browser tabs by tabId. This is destructive and requires user confirmation.',
      parameters: {
        type: 'object',
        properties: {
          tabIds: { type: 'string', description: 'comma-separated tab IDs to close, e.g. "123,124"' },
          reason: { type: 'string', description: 'why these tabs should be closed' },
        },
        required: ['tabIds', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bookmark_tabs',
      description: 'Bookmark one or more tabs by tabId. If tabIds is omitted, bookmarks the current active tab.',
      parameters: {
        type: 'object',
        properties: {
          tabIds: { type: 'string', description: 'optional comma-separated tab IDs to bookmark' },
          folderTitle: { type: 'string', description: 'optional new bookmark folder title for the saved tabs' },
          reason: { type: 'string', description: 'why these tabs should be bookmarked' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'group_tabs',
      description: 'Group one or more tabs by tabId and optionally set a group title/color.',
      parameters: {
        type: 'object',
        properties: {
          tabIds: { type: 'string', description: 'comma-separated tab IDs to group, e.g. "123,124"' },
          title: { type: 'string', description: 'optional tab group title' },
          color: { type: 'string', description: 'optional group color', enum: ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] },
          collapsed: { type: 'string', description: '"true" to collapse the group, otherwise "false"' },
        },
        required: ['tabIds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ungroup_tabs',
      description: 'Remove one or more tabs from their tab group.',
      parameters: {
        type: 'object',
        properties: {
          tabIds: { type: 'string', description: 'comma-separated tab IDs to ungroup, e.g. "123,124"' },
          reason: { type: 'string', description: 'why these tabs should be ungrouped' },
        },
        required: ['tabIds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'paste_table',
      description: 'Paste tab-separated table data into a spreadsheet/grid, filling rows and columns from the selected cell. Best for Google Sheets and Excel Online. Click a starting cell first, or pass its ref.',
      parameters: {
        type: 'object',
        properties: {
          tsv: { type: 'string', description: 'table data as TSV: columns separated by tabs, rows separated by newlines' },
          ref: { type: 'string', description: 'optional starting cell/grid ref from the latest snapshot' },
          reason: { type: 'string', description: 'short reason for this paste' },
        },
        required: ['tsv'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fill_cells',
      description: 'Fill a spreadsheet cell-by-cell from TSV data. For Google Sheets this selects each cell range (A1, B1, ...) and types values individually instead of pasting a whole table.',
      parameters: {
        type: 'object',
        properties: {
          tsv: { type: 'string', description: 'table data as TSV: columns separated by tabs, rows separated by newlines' },
          startCell: { type: 'string', description: 'starting cell in A1 notation, default A1' },
          reason: { type: 'string', description: 'short reason for filling cells' },
        },
        required: ['tsv'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'select_cell',
      description: 'Select a Google Sheets cell by A1 notation, e.g. A1, B2, AA10. Use before editing or checking a specific cell.',
      parameters: {
        type: 'object',
        properties: {
          cell: { type: 'string', description: 'cell in A1 notation' },
          reason: { type: 'string', description: 'short reason for selecting this cell' },
        },
        required: ['cell'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_cell',
      description: 'Set one Google Sheets cell to one value. This selects the cell, clears it, writes the value, and verifies it by copying the cell back.',
      parameters: {
        type: 'object',
        properties: {
          cell: { type: 'string', description: 'cell in A1 notation' },
          value: { type: 'string', description: 'value to put into the cell' },
          reason: { type: 'string', description: 'short reason for setting this cell' },
        },
        required: ['cell', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'define_sheet_contract',
      description: 'Declare the expected Google Sheets table/range before filling it. Runtime blocks final done until the declared rows and columns have been written.',
      parameters: {
        type: 'object',
        properties: {
          startCell: { type: 'string', description: 'top-left cell in A1 notation, default A1' },
          rows: { type: 'number', description: 'total rows required, including header rows' },
          columns: { type: 'number', description: 'total columns required' },
          description: { type: 'string', description: 'short description of the required table' },
        },
        required: ['rows', 'columns'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_cells',
      description: 'Read cell values from a Google Sheets range. Returns the values as a 2D array (rows of columns).',
      parameters: {
        type: 'object',
        properties: {
          range: { type: 'string', description: 'Range in A1 notation, e.g. "A1:C5" or "Sheet1!A1:C5"' },
          reason: { type: 'string', description: 'short reason for reading cells' },
        },
        required: ['range'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fill_login_credentials',
      description: 'Fill username/email and password fields using credentials stored in the extension session vault for the current site. The model never sees the password.',
      parameters: {
        type: 'object',
        properties: {
          usernameRef: { type: 'string', description: 'ref for username/email input' },
          passwordRef: { type: 'string', description: 'ref for password input' },
          submit: { type: 'string', description: '"true" to press Enter after filling password, otherwise "false"' },
          reason: { type: 'string', description: 'short reason for filling login credentials' },
        },
        required: ['usernameRef', 'passwordRef'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_subtask',
      description: 'Mark an orchestrator subtask as running before working on it. Use the subtask id or index shown in the orchestrator progress block.',
      parameters: {
        type: 'object',
        properties: {
          subtaskId: { type: 'string', description: 'subtask id or index, e.g. "1" or "task-1-sub-1"' },
          note: { type: 'string', description: 'short note about what will be done' },
        },
        required: ['subtaskId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish_subtask',
      description: 'Mark the current orchestrator subtask as complete and store its result. Use this before moving to the next subtask.',
      parameters: {
        type: 'object',
        properties: {
          subtaskId: { type: 'string', description: 'subtask id or index, e.g. "1" or "task-1-sub-1"' },
          result: { type: 'string', description: 'concise result produced by this subtask' },
        },
        required: ['subtaskId', 'result'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fail_subtask',
      description: 'Mark an orchestrator subtask as failed when it cannot be completed after recovery attempts.',
      parameters: {
        type: 'object',
        properties: {
          subtaskId: { type: 'string', description: 'subtask id or index, e.g. "1" or "task-1-sub-1"' },
          error: { type: 'string', description: 'why this subtask failed and what was tried' },
        },
        required: ['subtaskId', 'error'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task_memory',
      description: 'Save a compact progress summary for long tasks. Use after important milestones or before risky navigation.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'compact summary of completed work, open questions, and next action' },
        },
        required: ['summary'],
      },
    },
  },
];

export const TOOL_NAMES = AGENT_TOOLS.map((t) => t.function.name);

const CORE_TOOL_NAMES: AgentActionName[] = [
  'click', 'type', 'press', 'select', 'scroll', 'navigate', 'wait', 'extract', 'done',
];

const TAB_TOOL_NAMES: AgentActionName[] = [
  'open_tab', 'switch_tab', 'list_tabs', 'close_tabs', 'bookmark_tabs', 'group_tabs', 'ungroup_tabs',
];

const SHEET_TOOL_NAMES: AgentActionName[] = [
  'paste_table', 'fill_cells', 'select_cell', 'set_cell', 'define_sheet_contract', 'read_cells',
];

const ORCHESTRATOR_TOOL_NAMES: AgentActionName[] = [
  'start_subtask', 'finish_subtask', 'fail_subtask', 'update_task_memory',
];

export interface AgentToolContext {
  goal: string;
  snapshot?: Pick<A11ySnapshot, 'url' | 'nodes'>;
  firstStep?: boolean;
  hasCredential?: boolean;
}

/**
 * Keep each model decision focused on tools that can plausibly help in the current task.
 * The full registry remains the source of truth; this only narrows the schemas sent on a call.
 */
export function selectAgentTools(context: AgentToolContext): OllamaToolDef[] {
  const goal = context.goal.toLowerCase();
  const url = context.snapshot?.url.toLowerCase() ?? '';
  const nodeText = context.snapshot?.nodes
    .slice(0, 80)
    .map((node) => `${node.role} ${node.name}`.toLowerCase())
    .join(' ') ?? '';
  const names = new Set<AgentActionName>(CORE_TOOL_NAMES);

  const batchableNodes = context.snapshot?.nodes.filter((node) =>
    ['button', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'tab'].includes(node.role),
  ).length ?? 0;
  if (batchableNodes >= 2) names.add('batch_actions');

  if (context.firstStep) names.add('set_task_plan');

  if (/\b(tab|tabs|bookmark|bookmarks|group tabs|multi-tab|multiple sources|several sites|compare|research)\b|вклад|заклад|групп.*вклад|нескольк.*(?:сайт|источник)|сравн|исслед/.test(goal)) {
    for (const name of TAB_TOOL_NAMES) names.add(name);
  }

  if (/docs\.google\.com\/spreadsheets|\b(sheet|spreadsheet|cells?|rows?|columns?|table|tsv)\b|таблиц|ячейк|строк|столб/.test(`${goal} ${url}`)) {
    for (const name of SHEET_TOOL_NAMES) names.add(name);
  }

  if (context.hasCredential || /\b(log ?in|sign ?in|credential|username|password)\b|войти|логин|парол/.test(`${goal} ${nodeText}`)) {
    names.add('fill_login_credentials');
  }

  if (/\b(download|downloaded|file|attachment|pdf|document)\b|скача|файл|вложен|документ/.test(goal)) {
    names.add('read_downloaded_file');
  }

  if (/\b(captcha|recaptcha|hcaptcha)\b|капч/.test(`${goal} ${nodeText}`)) {
    names.add('solve_captcha');
  }

  if (/\b(subtasks?|parallel|in parallel|workstream)\b|подзадач|параллел/.test(goal)) {
    for (const name of ORCHESTRATOR_TOOL_NAMES) names.add(name);
  }

  return AGENT_TOOLS.filter((tool) => names.has(tool.function.name as AgentActionName));
}
