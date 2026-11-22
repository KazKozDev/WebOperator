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

// Shared, optional tool properties understood by the extension itself:
// `tabId` acts on one specific tab instead of the focused one, `ref` targets an
// element straight from a snapshot (e.g. "@e12") — including scroll containers,
// which is how a virtualized list (Gmail, chat apps) is scrolled without
// touching the window.
const { TOOLS, TOOL_TYPES, imageContent } = require('./tools');

process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') process.exit(0);
});
process.on('uncaughtException', (err) => {
  if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED')) process.exit(0);
});



async function callBridge(type, payload = {}, timeoutMs = 60_000) {
  // Try Unix Domain Socket first
  try {
    return await callSocket(type, payload, timeoutMs);
  } catch (err) {
    // Once the bridge has taken the request, its answer is the answer. A
    // retry over HTTP would hide the real error behind whatever the second
    // attempt says, and after a timeout it would run the action again — a
    // second click, a second form submission.
    if (err && err.reachedBridge) throw err;
    // The socket could not be opened at all: fall back to the HTTP API.
    return await callHttp(type, payload, timeoutMs);
  }
}

// The socket takes the extension's own request types; the HTTP API has its
// own routes and tool names. This is the translation between the two.
function httpRequestFor(type, payload, timeoutMs) {
  if (type === 'tasks.start') {
    return { path: '/v1/tasks', body: payload };
  }
  if (type === 'tasks.wait') {
    return {
      path: `/v1/tasks/${encodeURIComponent(payload.id)}/wait`,
      body: { timeoutMs: payload.timeoutMs },
    };
  }
  // browser.snapshot -> browser_snapshot, and so on for every browser tool.
  return {
    path: '/v1/tools/call',
    body: { tool: Object.keys(TOOL_TYPES).find((name) => TOOL_TYPES[name] === type) ?? type.replace('.', '_'), arguments: payload, timeoutMs },
  };
}


function callSocket(type, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let connected = false;
    const fail = (err) => reject(Object.assign(err, { reachedBridge: connected }));
    const socket = net.createConnection(SOCKET_PATH);
    const id = randomUUID();
    const message = { id, type, payload, timeoutMs, ...(API_TOKEN ? { token: API_TOKEN } : {}) };

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        fail(new Error(`Bridge socket timeout for ${type}`));
      }
    }, timeoutMs);

    let buffer = Buffer.alloc(0);
    let nextLength = null;

    socket.on('connect', () => {
      connected = true;
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
            if (msg.error) fail(new Error(msg.error));
            else resolve(msg.result);
          }
        } catch (parseErr) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            socket.destroy();
            fail(parseErr);
          }
        }
      }
    });

    socket.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        fail(err);
      }
    });
  });
}

function callHttp(type, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const { path, body: bodyObj } = httpRequestFor(type, payload, timeoutMs);
    const method = 'POST';

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

// Snapshot refs look like "@e12". A bare numeric index maps onto the same
// scheme ("12" -> "@e12"), anything already carrying the "@" prefix or a CSS
// selector is passed through untouched.
function assertActionSucceeded(res) {
  const result = res?.kind === 'action:result' ? res.result : res;
  if (res?.kind === 'error' || result?.ok === false) throw new Error(result?.error || res.error || 'Browser action failed');
}

function refArg(args = {}) {
  if (args.ref !== undefined && args.ref !== null && args.ref !== '') return String(args.ref);
  if (args.index !== undefined && args.index !== null && args.index !== '') {
    const raw = String(args.index).trim();
    if (raw.startsWith('@')) return raw;
    return `@e${raw.replace(/^e/i, '')}`;
  }
  return '';
}

function refPayload(args = {}) {
  const payload = {};
  const ref = refArg(args);
  if (ref) payload.ref = ref;
  if (args.selector !== undefined && args.selector !== null && args.selector !== '') payload.selector = String(args.selector);
  return payload;
}

function tabIdArg(args = {}) {
  const raw = args.tabId;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function withTabId(payload, args = {}) {
  const tabId = tabIdArg(args);
  return tabId === undefined ? payload : { ...payload, tabId };
}

// The extension types via `mode`; the historic MCP `clear` flag is mapped onto it.
function typeOptions(args = {}) {
  if (args.mode === 'append' || args.mode === 'replace') return { mode: args.mode };
  if (args.clear === true) return { mode: 'replace' };
  if (args.clear === false) return { mode: 'append' };
  return {};
}

async function handleToolCall(name, args) {
  if (name.startsWith('agent_task_') || name.startsWith('tabs_') || name === 'browser_eval' || name === 'browser_wait') {
    if (!TOOL_TYPES[name]) throw new Error(`Unknown tool: ${name}`);
    const timeoutMs = Number(args.timeoutMs ?? (name === 'agent_task_wait' || (name === 'agent_task_start' && args.wait) ? 120_000 : 30_000)) + 10_000;
    const res = await callBridge(TOOL_TYPES[name], args, timeoutMs);
    return { ...(res?.ok === false ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }
  switch (name) {
    case 'browser_image': {
      const res = await callBridge('browser.image', args, 30_000);
      return { content: imageContent(res) };
    }
    case 'browser_snapshot': {
      const res = await callBridge('browser.snapshot', args, 30_000);
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
      const res = await callBridge('browser.navigate', withTabId({ url: args.url }, args), 60_000);
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
      const res = await callBridge('browser.click', withTabId({ ...refPayload(args), ...(args.button !== undefined ? { button: args.button } : {}), ...(args.clickCount !== undefined ? { clickCount: args.clickCount } : {}), ...(args.modifiers !== undefined ? { modifiers: args.modifiers } : {}) }, args), 30_000);
      assertActionSucceeded(res);
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
      const res = await callBridge('browser.type', withTabId({ ...refPayload(args), text: args.text, ...typeOptions(args) }, args), 30_000);
      assertActionSucceeded(res);
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
      const res = await callBridge('browser.press', withTabId({ ...refPayload(args), key: args.key, ...(args.modifiers ? { modifiers: String(args.modifiers) } : {}) }, args), 30_000);
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
      const amount = Number(args.amount || 500);
      const res = await callBridge('browser.scroll', withTabId({ ...refPayload(args), direction: args.direction || 'down', amount, amountPx: amount, ...(args.to !== undefined ? { to: args.to, block: args.block ?? 'center' } : {}) }, args), 30_000);
      assertActionSucceeded(res);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(res, null, 2),
          },
        ],
      };
    }
    case 'browser_screenshot': {
      const res = await callBridge('browser.screenshot', args, 30_000);
      if (res?.path) return { content: [{ type: 'text', text: JSON.stringify({ path: res.path, w: res.w, h: res.h }) }] };
      const dataUri = res?.dataUrl || res?.dataUri || res?.screenshot || '';
      const base64Data = dataUri.replace(/^data:image\/[a-z]+;base64,/, '');
      if (base64Data) {
        return {
          content: [
            {
              type: 'image',
              data: base64Data,
              mimeType: dataUri.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png',
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
      const res = await callBridge('browser.extract', withTabId({ ...refPayload(args), instruction: args.instruction, selector: args.selector, ...(args.schema !== undefined ? { schema: args.schema } : {}) }, args), args.schema ? 120_000 : 30_000);
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
      const res = await callBridge('browser.solve_captcha', withTabId({ type: args.type === 'auto' ? undefined : args.type }, args), 30_000);
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
      const startRes = await callBridge('tasks.start', withTabId({ ...args, goal: args.goal, timeoutMs: taskTimeout, wait: false }, args), 30_000);
      const taskId = startRes && (startRes.taskId || startRes.id);
      if (args.wait === false) return { content: [{ type: 'text', text: JSON.stringify({ ...startRes, taskId }, null, 2) }] };
      let finalTask = startRes;
      if (taskId) {
        finalTask = await callBridge('tasks.wait', { id: taskId, timeoutMs: taskTimeout }, taskTimeout + 10_000);
      }
      const formatted = formatTaskResultForAgent(finalTask || startRes);
      const responseText = JSON.stringify(formatted, null, 2);
      return {
        content: [
          {
            type: 'text',
            text: responseText,
          },
        ],
      };
    }
    default: {
      if (!TOOL_TYPES[name]) throw new Error(`Unknown tool: ${name}`);
      const timeout = Math.max(30000, Number(args.timeoutMs ?? (name === 'browser_download' ? 120000 : 0)) + 10000);
      const res = await callBridge(TOOL_TYPES[name], args, timeout);
      assertActionSucceeded(res);
      return { content: [{ type: 'text', text: typeof res === 'string' ? res : JSON.stringify(res, null, 2) }] };
    }
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
    taskId: task.taskId || task.id,
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
