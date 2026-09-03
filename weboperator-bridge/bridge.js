#!/usr/bin/env node
// WebOperator Bridge — framed agent socket plus compatibility HTTP API over Chrome Native Messaging.
const http = require('http');
const net = require('net');
const { randomUUID } = require('crypto');
const fs = require('fs');

const HOST = process.env.WEBOPERATOR_BRIDGE_HOST || '127.0.0.1';
const PORT = Number(process.env.WEBOPERATOR_BRIDGE_PORT || 8765);
const LOG = process.env.WEBOPERATOR_BRIDGE_LOG || '/tmp/weboperator-bridge.log';
const API_TOKEN = process.env.WEBOPERATOR_API_TOKEN || '';
const ALLOW_UNAUTHENTICATED = process.env.WEBOPERATOR_ALLOW_UNAUTHENTICATED_BRIDGE !== '0';
const AGENT_SOCKET = process.env.WEBOPERATOR_AGENT_SOCKET || '/tmp/weboperator-bridge.sock';


const PID_FILE = process.env.WEBOPERATOR_BRIDGE_PID_FILE || `/tmp/weboperator-bridge-${PORT}.pid`;


function log(line) {
  try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); } catch {}
}

let ownsEndpointLease = false;

function tryAcquireEndpointLease() {
  try {
    if (fs.existsSync(PID_FILE)) {
      const oldPid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
      if (oldPid === process.pid) return true;
      if (oldPid) {
        try { process.kill(oldPid, 0); return false; } catch {}
      }
      fs.unlinkSync(PID_FILE);
    }
  } catch {}
  try {
    const fd = fs.openSync(PID_FILE, 'wx', 0o600);
    fs.writeFileSync(fd, String(process.pid));
    fs.closeSync(fd);
    ownsEndpointLease = true;
    return true;
  } catch { return false; }
}

tryAcquireEndpointLease();

log(`process start pid=${process.pid} ppid=${process.ppid} argv=${JSON.stringify(redactArgv(process.argv))} cwd=${process.cwd()}`);
process.on('beforeExit', (code) => log(`beforeExit code=${code}`));
process.on('exit', (code) => {
  log(`exit code=${code}`);
  if (ownsEndpointLease) {
    try {
      if (fs.existsSync(PID_FILE) && Number(fs.readFileSync(PID_FILE, 'utf8').trim()) === process.pid) fs.unlinkSync(PID_FILE);
    } catch {}
  }
});

process.on('uncaughtException', (err) => log(`uncaughtException ${err && err.stack ? err.stack : err}`));
process.on('unhandledRejection', (err) => log(`unhandledRejection ${err && err.stack ? err.stack : err}`));
process.on('SIGTERM', () => {
  log('SIGTERM received');
  process.exit(0);
});
process.on('SIGINT', () => {
  log('SIGINT received');
  process.exit(130);
});
process.stdout.on('error', (err) => log(`stdout error: ${err.message}`));
process.stderr.on('error', (err) => log(`stderr error: ${err.message}`));

function redactArgv(argv) {
  const redacted = [];
  let redactNext = false;
  for (const arg of argv) {
    if (redactNext) {
      redacted.push('[REDACTED]');
      redactNext = false;
      continue;
    }
    if (/^(--?(?:api[-_]?token|token|secret|password|key))$/i.test(arg)) {
      redacted.push(arg);
      redactNext = true;
      continue;
    }
    redacted.push(arg.replace(/^(--?(?:api[-_]?token|token|secret|password|key)=).+/i, '$1[REDACTED]'));
  }
  return redacted;
}

let extensionOnline = false;
let inputBuffer = Buffer.alloc(0);
let nextFrameLength = null;
const pending = new Map();
const eventClients = new Map();
const agentClients = new Set();

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  readFrames();
});
process.stdin.on('end', () => {
  log('stdin end');
  extensionOnline = false;
  rejectAll(new Error('Extension native messaging stream closed'));
});
process.stdin.on('close', () => {
  log('stdin close');
});
process.stdin.on('error', (err) => {
  log(`stdin error: ${err.message}`);
  extensionOnline = false;
  rejectAll(err);
});

function readFrames() {
  while (true) {
    if (nextFrameLength === null) {
      if (inputBuffer.length < 4) return;
      nextFrameLength = inputBuffer.readUInt32LE(0);
      inputBuffer = inputBuffer.slice(4);
    }
    if (inputBuffer.length < nextFrameLength) return;
    const payload = inputBuffer.slice(0, nextFrameLength).toString('utf8');
    inputBuffer = inputBuffer.slice(nextFrameLength);
    nextFrameLength = null;
    try {
      handleNativeMessage(JSON.parse(payload));
    } catch (err) {
      log(`bad native message: ${err.message}`);
    }
  }
}

function sendNative(obj) {
  const json = JSON.stringify(obj);
  const body = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function handleNativeMessage(msg) {
  if (msg.kind === 'bridge:hello') {
    extensionOnline = true;
    log('extension online');
    return;
  }

  if (msg.kind === 'bridge:event') {
    publishTaskEvent(msg.event);
    publishAgentEvent(msg.event);
    return;
  }

  if (msg.kind === 'bridge:response') {
    const item = pending.get(msg.id);
    if (!item) return;
    pending.delete(msg.id);
    clearTimeout(item.timeout);
    if (msg.error) item.reject(new Error(msg.error));
    else item.resolve(msg.result);
  }
}

function rejectAll(err) {
  for (const [id, item] of pending) {
    clearTimeout(item.timeout);
    item.reject(err);
    pending.delete(id);
  }
}

function requestExtension(type, payload = {}, timeoutMs = 60_000) {
  if (!extensionOnline) throw new Error('WebOperator extension is not connected to the bridge');
  const id = randomUUID();
  const promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Bridge request timed out: ${type}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timeout });
  });
  sendNative({ kind: 'bridge:request', id, type, payload });
  return promise;
}

const server = http.createServer(async (req, res) => {
  try {
    writeCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    enforceAuth(req, url);
    if (tryHandleEventStream(req, req.method || 'GET', url, res)) return;

    const body = await readJson(req);
    const result = await route(req.method || 'GET', url, body);
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, statusForError(err), { error: err instanceof Error ? err.message : String(err) });
  }
});

server.on('error', (err) => {
  log(`http server error: ${err.message}`);
  if (err.code === 'EADDRINUSE') {
    setTimeout(() => {
      try { server.close(); } catch {}
      server.listen(PORT, HOST, () => log(`http retry listening on http://${HOST}:${PORT}`));
    }, 1000);
  }
});
function startEndpointServers() {
  server.listen(PORT, HOST, () => log(`http listening on http://${HOST}:${PORT}`));
  startAgentSocket();
}

if (ownsEndpointLease) startEndpointServers();
setInterval(() => {
  if (!ownsEndpointLease && tryAcquireEndpointLease()) startEndpointServers();
}, 1000).unref();

function writeCors(_req, res) {
  res.setHeader('access-control-allow-origin', 'http://127.0.0.1');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'authorization, content-type, x-weboperator-token');
}

async function readJson(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw httpError(400, 'Request body must be JSON'); }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function statusForError(err) {
  return Number(err && err.status) || 500;
}

function enforceAuth(req, url) {
  if (url.pathname.replace(/\/+$/, '') === '/health') return;
  if (!API_TOKEN && ALLOW_UNAUTHENTICATED) return;
  if (!API_TOKEN) throw httpError(401, 'WEBOPERATOR_API_TOKEN is required unless WEBOPERATOR_ALLOW_UNAUTHENTICATED_BRIDGE=1');

  const authorization = req.headers.authorization || '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
  const headerToken = String(req.headers['x-weboperator-token'] || '').trim();
  if (bearer === API_TOKEN || headerToken === API_TOKEN) return;
  throw httpError(401, 'Missing or invalid WebOperator API token');
}

async function route(method, url, body) {
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (method === 'GET' && path === '/health') {
    return { ok: true, bridge: 'online', extension: extensionOnline ? 'online' : 'offline', authRequired: Boolean(API_TOKEN) };
  }

  if (method === 'GET' && path === '/v1/tools') {
    return { tools: AGENT_TOOLS };
  }
  if (method === 'POST' && path === '/v1/tools/call') {
    const tool = body.tool || body.name || '';
    const args = body.arguments || body.parameters || body.payload || {};
    const timeout = Number(body.timeoutMs || 30_000);
    return executeToolByName(tool, args, timeout);
  }
  if (method === 'POST' && path === '/mcp') {
    return handleMcpHttp(body);
  }

  if (method === 'GET' && path === '/v1/browser/snapshot') {
    return requestExtension('browser.snapshot', {}, 30_000);
  }
  if (method === 'GET' && path === '/v1/browser/screenshot') {
    return requestExtension('browser.screenshot', {}, 30_000);
  }
  if (method === 'POST' && path === '/v1/browser/navigate') {
    return requestExtension('browser.navigate', body, 60_000);
  }
  if (method === 'POST' && path === '/v1/browser/click') {
    return requestExtension('browser.click', body, 30_000);
  }
  if (method === 'POST' && path === '/v1/browser/type') {
    return requestExtension('browser.type', body, 30_000);
  }
  if (method === 'POST' && path === '/v1/browser/press') {
    return requestExtension('browser.press', body, 30_000);
  }
  if (method === 'POST' && path === '/v1/browser/scroll') {
    return requestExtension('browser.scroll', body, 30_000);
  }
  if (method === 'POST' && path === '/v1/browser/extract') {
    return requestExtension('browser.extract', body, 30_000);
  }

  if (method === 'GET' && path === '/v1/tasks') {
    return requestExtension('tasks.list', {}, 30_000);
  }
  if (method === 'POST' && (path === '/v1/tasks' || path === '/v1/goal')) {
    return requestExtension('tasks.start', body, Number(body.timeoutMs || 60_000));
  }



  const taskMatch = path.match(/^\/v1\/tasks\/([^/]+)(?:\/([^/]+))?$/);
  if (taskMatch) {
    const id = decodeURIComponent(taskMatch[1]);
    const action = taskMatch[2] || '';
    if (method === 'GET' && !action) return requestExtension('tasks.get', { id }, 30_000);
    if (method === 'GET' && action === 'trace') return requestExtension('tasks.get', { id }, 30_000);
    if (method === 'GET' && action === 'events') throw httpError(405, 'Use the event stream handler for this endpoint');
    if (method === 'POST' && action === 'stop') return requestExtension('tasks.stop', { id }, 30_000);
    if (method === 'POST' && action === 'pause') return requestExtension('tasks.pause', { id }, 30_000);
    if (method === 'POST' && action === 'resume') return requestExtension('tasks.resume', { id }, 30_000);
    if (method === 'POST' && action === 'confirm') return requestExtension('tasks.confirm', { id, allow: body.allow }, 30_000);
    if (method === 'POST' && action === 'wait') {
      return requestExtension('tasks.wait', { id, timeoutMs: body.timeoutMs }, Number(body.timeoutMs || 120_000) + 5_000);
    }
  }

  throw httpError(404, `Unknown endpoint: ${method} ${path}`);
}

function tryHandleEventStream(req, method, url, res) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const match = path.match(/^\/v1\/tasks\/([^/]+)\/events$/);
  if (!match) return false;
  if (method !== 'GET') throw httpError(405, 'Task event streams require GET');

  const taskId = decodeURIComponent(match[1]);
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': connected\n\n');

  const client = { res, taskId };
  let clients = eventClients.get(taskId);
  if (!clients) {
    clients = new Set();
    eventClients.set(taskId, clients);
  }
  clients.add(client);

  const heartbeat = setInterval(() => {
    writeSse(res, 'heartbeat', { at: Date.now() });
  }, 15_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(client);
    if (clients.size === 0) eventClients.delete(taskId);
  });

  sendInitialTaskEvent(taskId, res).catch((err) => {
    writeSse(res, 'task.error', { taskId, error: err instanceof Error ? err.message : String(err) });
  });
  return true;
}

async function sendInitialTaskEvent(taskId, res) {
  if (!extensionOnline) {
    writeSse(res, 'bridge.status', { extension: 'offline' });
    return;
  }
  const task = await requestExtension('tasks.get', { id: taskId }, 30_000);
  writeSse(res, 'task.snapshot', { taskId, task });
}

function publishTaskEvent(event) {
  const taskId = taskIdForEvent(event);
  if (!taskId) return;
  const clients = eventClients.get(taskId);
  if (!clients) return;
  const name = String(event.kind || 'task.event').replace(/:/g, '.');
  for (const client of clients) {
    writeSse(client.res, name, event);
  }
}

function taskIdForEvent(event) {
  if (!event || typeof event !== 'object') return '';
  if (typeof event.taskId === 'string') return event.taskId;
  if (event.task && typeof event.task === 'object' && typeof event.task.id === 'string') return event.task.id;
  return '';
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function startAgentSocket() {
  let socketInode = null;
  try {
    if (fs.existsSync(AGENT_SOCKET)) fs.unlinkSync(AGENT_SOCKET);
  } catch (err) {
    log(`agent socket cleanup failed: ${err.message}`);
  }

  const socketServer = net.createServer((socket) => {
    const client = { socket, buffer: Buffer.alloc(0), nextFrameLength: null };
    agentClients.add(client);

    socket.on('data', (chunk) => {
      client.buffer = Buffer.concat([client.buffer, chunk]);
      readAgentFrames(client);
    });
    socket.on('close', () => agentClients.delete(client));
    socket.on('error', (err) => {
      log(`agent socket error: ${err.message}`);
      agentClients.delete(client);
    });
  });

  socketServer.on('error', (err) => log(`agent socket server error: ${err.message}`));
  socketServer.listen(AGENT_SOCKET, () => {
    try { fs.chmodSync(AGENT_SOCKET, 0o600); } catch {}
    try { socketInode = fs.statSync(AGENT_SOCKET).ino; } catch {}
    log(`agent socket listening on ${AGENT_SOCKET}`);
  });

  process.on('exit', () => {
    try {
      if (socketInode !== null && fs.existsSync(AGENT_SOCKET) && fs.statSync(AGENT_SOCKET).ino === socketInode) fs.unlinkSync(AGENT_SOCKET);
    } catch {}
  });
}

function readAgentFrames(client) {
  while (true) {
    if (client.nextFrameLength === null) {
      if (client.buffer.length < 4) return;
      client.nextFrameLength = client.buffer.readUInt32LE(0);
      client.buffer = client.buffer.slice(4);
    }
    if (client.buffer.length < client.nextFrameLength) return;
    const payload = client.buffer.slice(0, client.nextFrameLength).toString('utf8');
    client.buffer = client.buffer.slice(client.nextFrameLength);
    client.nextFrameLength = null;
    try {
      void handleAgentMessage(client, JSON.parse(payload));
    } catch (err) {
      sendAgentFrame(client.socket, { id: undefined, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

async function handleAgentMessage(client, msg) {
  const id = msg.id || randomUUID();
  try {
    enforceAgentAuth(msg);
    const type = String(msg.type || '');
    const payload = msg.payload && typeof msg.payload === 'object' ? msg.payload : {};
    const timeoutMs = Number(msg.timeoutMs || 60_000);
    const result = type === 'bridge.health'
      ? { ok: true, bridge: 'online', extension: extensionOnline ? 'online' : 'offline', authRequired: Boolean(API_TOKEN) }
      : await requestExtension(type, payload, timeoutMs);
    sendAgentFrame(client.socket, { id, result });
  } catch (err) {
    sendAgentFrame(client.socket, { id, error: err instanceof Error ? err.message : String(err) });
  }
}

function enforceAgentAuth(msg) {
  if (!API_TOKEN && ALLOW_UNAUTHENTICATED) return;
  if (!API_TOKEN) throw new Error('WEBOPERATOR_API_TOKEN is required unless WEBOPERATOR_ALLOW_UNAUTHENTICATED_BRIDGE=1');
  if (msg.token === API_TOKEN) return;
  throw new Error('Missing or invalid WebOperator API token');
}

function publishAgentEvent(event) {
  for (const client of agentClients) {
    sendAgentFrame(client.socket, { kind: 'event', event });
  }
}

function sendAgentFrame(socket, obj) {
  if (socket.destroyed) return;
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  socket.write(Buffer.concat([header, body]));
}

const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'browser_snapshot',
      description: 'Capture the structured accessibility tree and numbered interactive elements from the active tab.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description: 'Navigate the active browser tab to a specified URL.',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Click an element on the active webpage by numeric index or selector.',
      parameters: { type: 'object', properties: { index: { type: 'number' }, selector: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: 'Type text into an input field by element index or selector.',
      parameters: { type: 'object', properties: { index: { type: 'number' }, selector: { type: 'string' }, text: { type: 'string' }, clear: { type: 'boolean' } }, required: ['text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_press',
      description: 'Press a keyboard key on the active webpage (e.g. Enter, Tab, Escape).',
      parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_scroll',
      description: 'Scroll the active webpage.',
      parameters: { type: 'object', properties: { direction: { type: 'string', enum: ['down', 'up'] }, amount: { type: 'number' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description: 'Capture a visual PNG screenshot of the current tab.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_extract',
      description: 'Extract targeted text or structured content from the page.',
      parameters: { type: 'object', properties: { instruction: { type: 'string' }, selector: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_solve_captcha',
      description: 'Attempt to detect and automatically solve or click Cloudflare Turnstile, reCAPTCHA, or hCaptcha verification challenges in the active tab.',
      parameters: { type: 'object', properties: { type: { type: 'string', enum: ['cloudflare', 'recaptcha', 'hcaptcha', 'auto'] } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'weboperator_execute_goal',
      description: 'Execute an autonomous browser goal end-to-end.',
      parameters: { type: 'object', properties: { goal: { type: 'string' }, timeoutMs: { type: 'number' } }, required: ['goal'] },
    },
  },
];

async function executeToolByName(name, args = {}, timeoutMs = 30_000) {
  switch (name) {
    case 'browser_snapshot':
      return requestExtension('browser.snapshot', {}, timeoutMs);
    case 'browser_navigate':
      return requestExtension('browser.navigate', { url: args.url }, timeoutMs);
    case 'browser_click':
      return requestExtension('browser.click', { index: args.index, selector: args.selector }, timeoutMs);
    case 'browser_type':
      return requestExtension('browser.type', { index: args.index, selector: args.selector, text: args.text, clear: args.clear }, timeoutMs);
    case 'browser_press':
      return requestExtension('browser.press', { key: args.key }, timeoutMs);
    case 'browser_scroll':
      return requestExtension('browser.scroll', { direction: args.direction || 'down', amount: args.amount || 500 }, timeoutMs);
    case 'browser_screenshot':
      return requestExtension('browser.screenshot', {}, timeoutMs);
    case 'browser_extract':
      return requestExtension('browser.extract', { instruction: args.instruction, selector: args.selector }, timeoutMs);
    case 'browser_solve_captcha':
      return requestExtension('browser.solve_captcha', { type: args.type === 'auto' ? undefined : args.type }, timeoutMs);
    case 'weboperator_execute_goal': {
      const taskTimeout = Number(args.timeoutMs || timeoutMs || 120_000);
      const startRes = await requestExtension('tasks.start', { goal: args.goal, timeoutMs: taskTimeout }, 30_000);
      const taskId = startRes && startRes.id;
      if (!taskId) return startRes;
      const finalTask = await requestExtension('tasks.wait', { id: taskId, timeoutMs: taskTimeout }, taskTimeout + 10_000);
      return formatTaskResultForAgent(finalTask || startRes);
    }
    default:
      throw httpError(400, `Unknown tool: ${name}`);
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


async function handleMcpHttp(msg) {
  const { id, method, params } = msg || {};
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'weboperator-bridge', version: '1.4.0' },
      },
    };
  }
  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: AGENT_TOOLS.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          inputSchema: t.function.parameters,
        })),
      },
    };
  }
  if (method === 'tools/call') {
    const { name, arguments: toolArgs } = params || {};
    try {
      const res = await executeToolByName(name, toolArgs || {}, 30_000);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: typeof res === 'string' ? res : JSON.stringify(res, null, 2) }],
        },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        },
      };
    }
  }
  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}
