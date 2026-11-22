const TAB_ID_PROP = {
  tabId: {
    type: 'number',
    description: 'Optional browser tab id to act on instead of the focused tab.',
  },
};
const REF_PROP = {
  ref: {
    type: 'string',
    description: 'Element reference from browser_snapshot (e.g. "@e12"). Preferred over index; also used to target a scroll container.',
  },
};

const TOOLS = [
  {
    name: 'browser_snapshot',
    description: 'Capture the structured accessibility tree and numbered interactive elements (buttons, inputs, links) from a browser tab (the focused one unless tabId is given).',
    inputSchema: {
      type: 'object',
      properties: {
        ...TAB_ID_PROP,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'browser_navigate',
    description: 'Navigate a browser tab (the focused one unless tabId is given) to a specified URL.',
    inputSchema: {
      type: 'object',
      properties: {
        ...TAB_ID_PROP,
        url: {
          type: 'string',
          description: 'The URL to navigate to (e.g. "https://google.com").',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element on the webpage by its snapshot ref (e.g. "@e12"), numeric index, or CSS selector.',
    inputSchema: {
      type: 'object',
      properties: {
        ...TAB_ID_PROP,
        ...REF_PROP,
        index: {
          type: 'number',
          description: 'The numeric index of the interactive element from the snapshot (mapped to ref "@e<index>").',
        },
        selector: {
          type: 'string',
          description: 'Alternative CSS selector of the element to click.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into an input field by snapshot ref, element index or CSS selector.',
    inputSchema: {
      type: 'object',
      properties: {
        ...TAB_ID_PROP,
        ...REF_PROP,
        index: {
          type: 'number',
          description: 'The numeric index of the input element from the snapshot (mapped to ref "@e<index>").',
        },
        selector: {
          type: 'string',
          description: 'Alternative CSS selector of the input element.',
        },
        text: {
          type: 'string',
          description: 'The text to type into the field.',
        },
        clear: {
          type: 'boolean',
          description: 'true replaces the field content, false appends to it (default: replace).',
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_press',
    description: 'Press a keyboard key on a webpage (e.g. "Enter", "Tab", "Escape", "ArrowDown", "Backspace").',
    inputSchema: {
      type: 'object',
      properties: {
        ...TAB_ID_PROP,
        ...REF_PROP,
        key: {
          type: 'string',
          description: 'The key to press (e.g. "Enter", "Tab", "Escape").',
        },
        modifiers: {
          type: 'string',
          description: 'Optional key modifiers, e.g. "Control+Shift".',
        },
      },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll a page or an inner scroll container. Pass ref to scroll a specific container (e.g. a virtualized message list) instead of the window.',
    inputSchema: {
      type: 'object',
      properties: {
        ...TAB_ID_PROP,
        ...REF_PROP,
        direction: {
          type: 'string',
          enum: ['down', 'up', 'top', 'bottom'],
          description: 'Direction to scroll (default: "down").',
        },
        amount: {
          type: 'number',
          description: 'Number of pixels to scroll (default: 500).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Capture a visual PNG screenshot of a browser tab (the focused one unless tabId is given).',
    inputSchema: {
      type: 'object',
      properties: {
        ...TAB_ID_PROP,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'browser_extract',
    description: 'Extract text or structured data from the webpage according to an extraction instruction.',
    inputSchema: {
      type: 'object',
      properties: {
        ...TAB_ID_PROP,
        ...REF_PROP,
        instruction: {
          type: 'string',
          description: 'Extraction guidance or prompt (e.g. "Extract all product prices and titles").',
        },
        selector: {
          type: 'string',
          description: 'Optional CSS selector to scope extraction.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'browser_solve_captcha',
    description: 'Attempt to detect and automatically solve or click Cloudflare Turnstile, reCAPTCHA, hCaptcha, slider puzzle, or visual text challenges in the active tab.',
    inputSchema: {
      type: 'object',
      properties: {
        ...TAB_ID_PROP,
        type: {
          type: 'string',
          enum: ['cloudflare', 'recaptcha', 'hcaptcha', 'slider', 'image', 'audio', 'press_and_hold', 'pow', 'auto'],
          description: 'Optional captcha type to target (default: auto).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'weboperator_execute_goal',
    description: 'Execute an autonomous browser goal end-to-end using WebOperator multi-step planner.',
    inputSchema: {
      type: 'object',
      properties: {
        ...TAB_ID_PROP,
        goal: {
          type: 'string',
          description: 'Natural language goal for the agent to achieve (e.g. "Find cheapest flight from Paris to Rome on Kayak").',
        },
        timeoutMs: {
          type: 'number',
          description: 'Maximum timeout in milliseconds (default: 120000).',
        },
      },
      required: ['goal'],
      additionalProperties: false,
    },
  },
];

const TIMEOUT = { type: 'integer', minimum: 0, maximum: 120000 };
const TASK_ID = { id: { type: 'string', minLength: 1 } };
const P0_TOOLS = [
  ['browser_eval', 'browser.eval', 'Evaluate JavaScript in the page main world. Nonzero frameId targets that Chrome frame when available to CDP.', {
    ...TAB_ID_PROP, expression: { type: 'string', minLength: 1 }, returnByValue: { type: 'boolean' }, awaitPromise: { type: 'boolean' },
    timeoutMs: { ...TIMEOUT, minimum: 1 }, frameId: { type: 'integer', minimum: 0 },
  }, ['expression']],
  ['browser_wait', 'browser.wait', 'Wait for a condition. urlPattern is a URL substring; network_idle observes fewer than 2 requests for 500ms, with an explicit DOM quiet fallback if CDP is unavailable.', {
    ...TAB_ID_PROP, ...REF_PROP, until: { type: 'string', enum: ['element', 'text', 'url', 'network_idle', 'load', 'timeout'] },
    selector: { type: 'string' }, text: { type: 'string' }, urlPattern: { type: 'string' },
    timeoutMs: TIMEOUT, pollMs: { type: 'integer', minimum: 10, maximum: 1000 }, visible: { type: 'boolean' },
  }, ['until']],
  ['tabs_list', 'tabs.list', 'List browser tabs with ids, titles, URLs and window ids.', {}, []],
  ['tabs_current', 'tabs.current', 'Return the focused browser tab id.', {}, []],
  ['tabs_open', 'tabs.open', 'Open a browser tab.', { url: { type: 'string', minLength: 1 }, active: { type: 'boolean' }, windowId: { type: 'integer', minimum: 1 } }, ['url']],
  ['tabs_activate', 'tabs.activate', 'Activate a tab and focus its window.', TAB_ID_PROP, ['tabId']],
  ['tabs_close', 'tabs.close', 'Close specified tabs, reporting individual errors.', { tabIds: { type: 'array', minItems: 1, items: { type: 'integer', minimum: 1 } } }, ['tabIds']],
  ['agent_task_start', 'tasks.start', 'Start a browser agent task; returns taskId immediately unless wait=true.', {
    ...TAB_ID_PROP, goal: { type: 'string', minLength: 1 }, startUrl: { type: 'string' }, autoConfirm: { type: 'boolean' }, wait: { type: 'boolean' }, timeoutMs: { ...TIMEOUT, maximum: 600000 },
  }, ['goal']],
  ['agent_task_list', 'tasks.list', 'List recent agent tasks.', { limit: { type: 'integer', minimum: 1, maximum: 1000 } }, []],
  ['agent_task_get', 'tasks.get', 'Read a task and its recorded steps.', TASK_ID, ['id']],
  ['agent_task_stop', 'tasks.stop', 'Request cooperative cancellation; an in-flight model call may finish first.', TASK_ID, ['id']],
  ['agent_task_confirm', 'tasks.confirm', 'Approve or reject a task pending confirmation.', { ...TASK_ID, approve: { type: 'boolean' }, allow: { type: 'boolean', description: 'Legacy alias for approve.' } }, ['id']],
  ['agent_task_pause', 'tasks.pause', 'Request cooperative pause at the next agent checkpoint.', TASK_ID, ['id']],
  ['agent_task_resume', 'tasks.resume', 'Resume a cooperatively paused task.', TASK_ID, ['id']],
  ['agent_task_wait', 'tasks.wait', 'Wait for a task to finish, or return its current state at timeout.', { ...TASK_ID, timeoutMs: { ...TIMEOUT, maximum: 600000 } }, ['id']],
];
for (const [name, , description, properties, required] of P0_TOOLS) {
  TOOLS.push({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } });
}
const goal = TOOLS.find((tool) => tool.name === 'weboperator_execute_goal');
Object.assign(goal.inputSchema.properties, {
  wait: { type: 'boolean', description: 'false returns taskId immediately; default true.' },
  startUrl: { type: 'string' }, autoConfirm: { type: 'boolean' },
});
const TOOL_TYPES = Object.fromEntries(TOOLS.map((tool) => [tool.name, P0_TOOLS.find(([name]) => name === tool.name)?.[1] ?? tool.name.replace('browser_', 'browser.')]));

TOOLS.find((tool) => tool.name === 'agent_task_confirm').inputSchema.anyOf = [{ required: ['approve'] }, { required: ['allow'] }];
Object.assign(TOOLS.find((tool) => tool.name === 'browser_scroll').inputSchema.properties, {
  to: { type: 'string', enum: ['element'] },
  block: { type: 'string', enum: ['start', 'center', 'end', 'nearest'] },
});

const EXTRA_TOOLS = [
  ['browser_image', 'browser.image', 'Read an image by snapshot ref, returning its bytes as MCP image content.', { ...REF_PROP }, ['ref']],
  ['browser_select_option', 'browser.select_option', 'Select an option in a native HTML select by value or label.', { ...REF_PROP, selector: { type: 'string' }, value: { type: 'string' } }, ['value']],
  ['browser_handle_dialog', 'browser.handle_dialog', 'Call action=status before triggering alert/confirm/prompt to start observing dialogs. Then explicitly accept or dismiss a pending dialog. Does not handle native file pickers or browser security prompts.', { action: { type: 'string', enum: ['status', 'accept', 'dismiss'] }, promptText: { type: 'string', maxLength: 10000 } }, ['action']],
  ['network_list', 'network.list', 'Start persistent capture for this tab and list captured XHR/fetch/document requests. Call before navigation to include initial traffic.', { sinceMs: { type: 'integer', minimum: 0 }, urlPattern: { type: 'string' }, type: { type: 'string', enum: ['xhr', 'fetch', 'document'] }, limit: { type: 'integer', minimum: 1, maximum: 500 } }, []],
  ['network_get', 'network.get', 'Read a captured response body (up to 5 MiB); request ids are scoped to tabId.', { requestId: { type: 'string', minLength: 1 } }, ['requestId']],
  ['network_clear', 'network.clear', 'Start capture and clear the tab request buffer.', {}, []],
  ['console_list', 'console.list', 'Start persistent console/error capture and list recent entries. Earlier page console history may be unavailable.', { sinceMs: { type: 'integer', minimum: 0 }, level: { type: 'string', enum: ['error', 'warn', 'log', 'all'] }, limit: { type: 'integer', minimum: 1, maximum: 500 } }, []],
  ['cookies_get', 'cookies.get', 'Read cookies via the existing debugger permission, filtered by domain or URL.', { domain: { type: 'string' }, url: { type: 'string' } }, []],
  ['cookies_set', 'cookies.set', 'Set a cookie for an HTTP(S) URL via the existing debugger permission.', { url: { type: 'string' }, name: { type: 'string' }, value: { type: 'string' }, domain: { type: 'string' }, path: { type: 'string' }, secure: { type: 'boolean' }, httpOnly: { type: 'boolean' }, sameSite: { type: 'string', enum: ['Strict', 'Lax', 'None'] }, expires: { type: 'number' } }, ['url', 'name', 'value']],
  ['storage_get', 'storage.get', 'Read local/session storage from the page origin.', { kind: { type: 'string', enum: ['local', 'session'] }, keys: { type: 'array', items: { type: 'string' } }, ...REF_PROP }, ['kind']],
  ['storage_set', 'storage.set', 'Write string values to page local/session storage.', { kind: { type: 'string', enum: ['local', 'session'] }, items: { type: 'object', additionalProperties: { type: 'string' } }, ...REF_PROP }, ['kind', 'items']],
  ['browser_upload_file', 'browser.upload_file', 'Select an existing local file in a file input. Native host validates an absolute regular-file path and size <=40 MiB.', { ...REF_PROP, path: { type: 'string', minLength: 1 } }, ['ref', 'path']],
  ['browser_download', 'browser.download', 'Download a URL and wait for completion.', { url: { type: 'string', minLength: 1 }, filename: { type: 'string' }, saveAs: { type: 'boolean' }, timeoutMs: { type: 'integer', minimum: 1, maximum: 300000 } }, ['url']],
  ['downloads_list', 'downloads.list', 'List browser downloads.', { sinceMs: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 500 } }, []],
  ['downloads_read', 'downloads.read', 'Read a completed local download by Chrome download id, without refetching its URL.', { downloadId: { type: 'integer', minimum: 1 }, maxBytes: { type: 'integer', minimum: 1, maximum: 20000000 } }, ['downloadId']],
  ['browser_read', 'browser.read', 'Read a page subtree as text or Markdown, preserving headings and links.', { ...REF_PROP, selector: { type: 'string' }, format: { type: 'string', enum: ['text', 'markdown'] }, maxChars: { type: 'integer', minimum: 1, maximum: 200000 } }, []],
  ['browser_hover', 'browser.hover', 'Move a real mouse pointer to an element, triggering hover menus.', { ...REF_PROP }, ['ref']],
  ['browser_drag', 'browser.drag', 'Drag between two snapshot refs using real mouse events.', { from: { type: 'string' }, to: { type: 'string' }, steps: { type: 'integer', minimum: 1, maximum: 100 }, modifiers: { type: 'string' } }, ['from', 'to']],
  ['clipboard_read', 'clipboard.read', 'Read system clipboard text (native host on macOS; page context elsewhere).', {}, []],
  ['clipboard_write', 'clipboard.write', 'Write system clipboard text (native host on macOS; page context elsewhere).', { text: { type: 'string' } }, ['text']],
];
for (const [name, type, description, properties, required] of EXTRA_TOOLS) {
  TOOLS.push({ name, description, inputSchema: { type: 'object', properties: { ...TAB_ID_PROP, ...properties }, required, additionalProperties: false } });
  TOOL_TYPES[name] = type;
}
const extend = (name, properties) => Object.assign(TOOLS.find((tool) => tool.name === name).inputSchema.properties, properties);
extend('browser_snapshot', {
  allElements: { type: 'boolean' }, maxNodes: { type: 'integer', minimum: 1, maximum: 10000 }, refPrefix: { type: 'string', maxLength: 32 },
  roles: { type: 'array', items: { type: 'string' } }, query: { type: 'string' }, text: { type: 'boolean' }, diff: { type: 'boolean' },
  includeImages: { type: 'boolean' }, minImageArea: { type: 'integer', minimum: 0 }, shadow: { type: 'boolean' },
});
extend('browser_extract', { schema: { type: 'object', description: 'JSON Schema, validated without eval. Unsupported keywords return an explicit error. Extraction uses the configured model.' } });
extend('browser_click', { button: { type: 'string', enum: ['left', 'right', 'middle'] }, clickCount: { type: 'integer', minimum: 1, maximum: 3 }, modifiers: { type: 'string' } });
extend('browser_screenshot', { ...REF_PROP, fullPage: { type: 'boolean' }, format: { type: 'string', enum: ['png', 'jpeg'] }, quality: { type: 'integer', minimum: 0, maximum: 100 }, saveTo: { type: 'string', description: 'Absolute local output path. Existing files are not overwritten.' } });

function imageContent(result) {
  if (!result || typeof result.base64 !== 'string' || !/^image\/(png|jpeg|webp|gif)$/.test(result.mimeType)) throw new Error('Expected a PNG, JPEG, WebP or GIF image from the extension');
  const { base64, ...metadata } = result;
  return [{ type: 'image', data: base64, mimeType: result.mimeType }, { type: 'text', text: JSON.stringify(metadata) }];
}

module.exports = { TOOLS, TOOL_TYPES, imageContent };
