#!/usr/bin/env node
/**
 * WebOperator MCP (Model Context Protocol) Server
 * Industry-standard tool provider for AI agents (Hermes, OpenClaw, Claude Desktop, Cursor, OpenHands).
 * Communicates over STDIO using standard JSON-RPC 2.0.
 */

const net = require('net');
const http = require('http');
const readline = require('readline');
const { randomUUID } = require('crypto');

const { version: SERVER_VERSION } = require('./package.json');

const SOCKET_PATH = process.env.WEBOPERATOR_AGENT_SOCKET || '/tmp/weboperator-bridge.sock';
const BRIDGE_HOST = process.env.WEBOPERATOR_BRIDGE_HOST || '127.0.0.1';
const BRIDGE_PORT = Number(process.env.WEBOPERATOR_BRIDGE_PORT || 8765);
const API_TOKEN = process.env.WEBOPERATOR_API_TOKEN || '';

process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') process.exit(0);
});
process.on('uncaughtException', (err) => {
  if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED')) process.exit(0);
});


const TOOLS = [
  {
    name: 'browser_snapshot',
    description: 'Capture the structured accessibility tree and numbered interactive elements (buttons, inputs, links) from the current active browser tab.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'browser_navigate',
    description: 'Navigate the active browser tab to a specified URL.',
    inputSchema: {
      type: 'object',
      properties: {
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
    description: 'Click an element on the webpage by its numeric index (from browser_snapshot) or CSS selector.',
    inputSchema: {
      type: 'object',
      properties: {
        index: {
          type: 'number',
          description: 'The numeric index of the interactive element from the snapshot.',
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
    description: 'Type text into an input field by element index or selector.',
    inputSchema: {
      type: 'object',
      properties: {
        index: {
          type: 'number',
          description: 'The numeric index of the input element from the snapshot.',
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
          description: 'Whether to clear existing text before typing (default: false).',
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_press',
    description: 'Press a keyboard key on the active webpage (e.g. "Enter", "Tab", "Escape", "ArrowDown", "Backspace").',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'The key to press (e.g. "Enter", "Tab", "Escape").',
        },
      },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the active webpage up or down.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['down', 'up'],
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
    description: 'Capture a visual PNG screenshot of the current active browser tab.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'browser_extract',
    description: 'Extract text or structured data from the webpage according to an extraction instruction.',
    inputSchema: {
      type: 'object',
      properties: {
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
    description: 'Attempt to detect and automatically solve or click Cloudflare Turnstile, reCAPTCHA, or hCaptcha verification challenges in the active tab.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['cloudflare', 'recaptcha', 'hcaptcha', 'auto'],
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

async function callBridge(type, payload = {}, timeoutMs = 60_000) {
  // Try Unix Domain Socket first
  try {
    return await callSocket(type, payload, timeoutMs);
  } catch {
    // Fallback to HTTP API
    return await callHttp(type, payload, timeoutMs);
  }
}


function callSocket(type, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const socket = net.createConnection(SOCKET_PATH);
    const id = randomUUID();
    const message = { id, type, payload, timeoutMs, ...(API_TOKEN ? { token: API_TOKEN } : {}) };

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        reject(new Error(`Bridge socket timeout for ${type}`));
      }
    }, timeoutMs);

    let buffer = Buffer.alloc(0);
    let nextLength = null;

    socket.on('connect', () => {
      const body = Buffer.from(JSON.stringify(message), 'utf8');
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length, 0);
      socket.write(Buffer.concat([header, body]));
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        if (nextLength === null) {
          if (buffer.length < 4) return;
          nextLength = buffer.readUInt32LE(0);
          buffer = buffer.slice(4);
        }
        if (buffer.length < nextLength) return;
        const raw = buffer.slice(0, nextLength).toString('utf8');
        buffer = buffer.slice(nextLength);
        nextLength = null;

        try {
          const msg = JSON.parse(raw);
          if (msg.kind === 'event') continue;
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            socket.end();
            if (msg.error) reject(new Error(msg.error));
            else resolve(msg.result);
          }
        } catch (parseErr) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            socket.destroy();
            reject(parseErr);
          }
        }
      }
    });

    socket.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

function callHttp(type, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    let path = '/v1/tools/call';
    const method = 'POST';
    const bodyObj = { tool: type, arguments: payload, timeoutMs };

    const headers = {
      'content-type': 'application/json',
      ...(API_TOKEN ? { authorization: `Bearer ${API_TOKEN}`, 'x-weboperator-token': API_TOKEN } : {}),
    };

    const req = http.request({
      host: BRIDGE_HOST,
      port: BRIDGE_PORT,
      path,
      method,
      headers,
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(json.error || `HTTP ${res.statusCode}`));
          } else {
            resolve(json.result !== undefined ? json.result : json);
          }
        } catch {
          reject(new Error(`Failed to parse HTTP bridge response: ${data}`));
        }

      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`HTTP bridge timeout for ${type}`));
    });

    req.write(JSON.stringify(bodyObj));
    req.end();
  });
}

async function handleToolCall(name, args) {
  switch (name) {
    case 'browser_snapshot': {
      const res = await callBridge('browser.snapshot', {}, 30_000);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(res, null, 2),
          },
        ],
      };
    }
    case 'browser_navigate': {
      const res = await callBridge('browser.navigate', { url: args.url }, 60_000);
      return {
        content: [
          {
            type: 'text',
            text: `Navigated to ${args.url}. Current title: ${res?.title || ''}`,
          },
        ],
      };
    }
    case 'browser_click': {
      const res = await callBridge('browser.click', { index: args.index, selector: args.selector }, 30_000);
      return {
        content: [
          {
            type: 'text',
            text: `Clicked element. ${res?.status || 'ok'}`,
          },
        ],
      };
    }
    case 'browser_type': {
      const res = await callBridge('browser.type', { index: args.index, selector: args.selector, text: args.text, clear: args.clear }, 30_000);
      return {
        content: [
          {
            type: 'text',
            text: `Typed into element: "${args.text}". ${res?.status || 'ok'}`,
          },
        ],
      };
    }
    case 'browser_press': {
      const res = await callBridge('browser.press', { key: args.key }, 30_000);
      return {
        content: [
          {
            type: 'text',
            text: `Pressed key "${args.key}". ${res?.status || 'ok'}`,
          },
        ],
      };
    }
    case 'browser_scroll': {
      const res = await callBridge('browser.scroll', { direction: args.direction || 'down', amount: args.amount || 500 }, 30_000);
      return {
        content: [
          {
            type: 'text',
            text: `Scrolled ${args.direction || 'down'}. ${res?.status || 'ok'}`,
          },
        ],
      };
    }
    case 'browser_screenshot': {
      const res = await callBridge('browser.screenshot', {}, 30_000);
      const dataUri = res?.dataUri || res?.screenshot || '';
      const base64Data = dataUri.replace(/^data:image\/[a-z]+;base64,/, '');
      if (base64Data) {
        return {
          content: [
            {
              type: 'image',
              data: base64Data,
              mimeType: 'image/png',
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(res, null, 2),
          },
        ],
      };
    }
    case 'browser_extract': {
      const res = await callBridge('browser.extract', { instruction: args.instruction, selector: args.selector }, 30_000);
      return {
        content: [
          {
            type: 'text',
            text: typeof res === 'string' ? res : JSON.stringify(res, null, 2),
          },
        ],
      };
    }
    case 'browser_solve_captcha': {
      const res = await callBridge('browser.solve_captcha', { type: args.type === 'auto' ? undefined : args.type }, 30_000);
      return {
        content: [
          {
            type: 'text',
            text: typeof res === 'string' ? res : JSON.stringify(res, null, 2),
          },
        ],
      };
    }
    case 'weboperator_execute_goal': {
      const taskTimeout = Number(args.timeoutMs || 120_000);
      const startRes = await callBridge('tasks.start', { goal: args.goal, timeoutMs: taskTimeout }, 30_000);
      const taskId = startRes && startRes.id;
      let finalTask = startRes;
      if (taskId) {
        finalTask = await callBridge('tasks.wait', { id: taskId, timeoutMs: taskTimeout }, taskTimeout + 10_000);
      }
      const formatted = formatTaskResultForAgent(finalTask || startRes);
      const responseText = formatted.answer || JSON.stringify(formatted, null, 2);
      return {
        content: [
          {
            type: 'text',
            text: responseText,
          },
        ],
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function formatTaskResultForAgent(task) {
  if (!task) return { ok: false, status: 'failed', error: 'Task not found or timed out' };

  const steps = Array.isArray(task.steps) ? task.steps : [];
  let answer = '';
  const extractedList = [];

  for (const step of steps) {
    if (step.toolCall) {
      const args = step.toolCall.arguments || {};
      if (step.toolCall.name === 'done') {
        if (args.answer || args.text || args.note || args.summary) {
          answer = String(args.answer || args.text || args.note || args.summary);
        }
      }
      if (step.toolCall.name === 'extract' && args.instruction) {
        if (step.result && step.result.extracted) {
          extractedList.push(step.result.extracted);
        }
      }
    }
    if (step.result && step.result.extracted !== undefined) {
      extractedList.push(step.result.extracted);
    }
    if (!answer && step.note && step.status === 'ok') {
      answer = step.note;
    }
  }

  if (!answer && extractedList.length > 0) {
    answer = typeof extractedList[extractedList.length - 1] === 'string'
      ? extractedList[extractedList.length - 1]
      : JSON.stringify(extractedList, null, 2);
  }

  if (!answer && task.plan && Array.isArray(task.plan.steps)) {
    const doneSteps = task.plan.steps.filter((s) => s.status === 'done');
    if (doneSteps.length > 0) {
      answer = doneSteps.map((s) => `✓ ${s.description}`).join('\n');
    }
  }

  if (!answer && task.status === 'done') {
    answer = `Goal completed successfully: "${task.goal}"`;
  } else if (!answer && task.status === 'failed') {
    answer = `Goal failed: ${task.error || 'Unknown error'}`;
  }

  return {
    ok: task.status === 'done',
    status: task.status,
    goal: task.goal,
    answer,
    extracted: extractedList.length > 0 ? extractedList : undefined,
    stepCount: steps.length,
    error: task.error,
    modelUsed: task.modelUsed,
  };
}


function sendJsonRpc(obj) {
  const line = JSON.stringify(obj) + '\n';
  process.stdout.write(line);
}

function sendResponse(id, result) {
  sendJsonRpc({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message, data) {
  sendJsonRpc({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    sendError(null, -32700, 'Parse error');
    return;
  }


  const { id, method, params } = msg;

  if (method === 'initialize') {
    sendResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: 'weboperator-mcp',
        version: SERVER_VERSION,
      },
    });
    return;
  }

  if (method === 'notifications/initialized' || method === 'initialized') {
    // Client notification, no response required
    return;
  }

  if (method === 'ping') {
    sendResponse(id, {});
    return;
  }

  if (method === 'tools/list') {
    sendResponse(id, { tools: TOOLS });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: toolArgs } = params || {};
    try {
      const result = await handleToolCall(name, toolArgs || {});
      sendResponse(id, result);
    } catch (err) {
      sendResponse(id, {
        isError: true,
        content: [
          {
            type: 'text',
            text: err instanceof Error ? err.message : String(err),
          },
        ],
      });
    }
    return;
  }

  if (id !== undefined) {
    sendError(id, -32601, `Method not found: ${method}`);
  }
});
