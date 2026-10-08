#!/usr/bin/env node
// The MCP server reaches the bridge over a Unix socket and falls back to the
// bridge's HTTP API when the socket cannot be opened. This drives the real
// mcp-server.js over stdio and checks both halves of that arrangement.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import http from 'node:http';
import readline from 'node:readline';

const root = new URL('..', import.meta.url);
const port = 21000 + Math.floor(Math.random() * 1000);
const token = 'test-token';
const socketPath = `/tmp/weboperator-mcp-smoke-${process.pid}.sock`;
const noSocket = `/tmp/weboperator-mcp-smoke-${process.pid}-absent.sock`;

const TOOL_CALLS = [
  ['browser_snapshot', {}],
  ['browser_navigate', { url: 'https://example.com' }],
  ['browser_click', { index: 1 }],
  ['browser_type', { index: 1, text: 'hello' }],
  ['browser_press', { key: 'Enter' }],
  ['browser_scroll', { direction: 'down' }],
  ['browser_screenshot', {}],
  ['browser_extract', { instruction: 'the title' }],
  ['browser_solve_captcha', { type: 'auto' }],
  ['weboperator_execute_goal', { goal: 'read the page' }],
];

// A real bridge with no extension attached: every request it understands
// fails the same way, and one it does not understand fails differently.
const bridge = spawn(process.execPath, ['weboperator-bridge/bridge.js'], {
  cwd: root,
  env: {
    ...process.env,
    WEBOPERATOR_BRIDGE_PORT: String(port),
    WEBOPERATOR_AGENT_SOCKET: socketPath,
    WEBOPERATOR_BRIDGE_LOG: '/tmp/weboperator-mcp-smoke.log',
    WEBOPERATOR_API_TOKEN: token,
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

// Stands in for the bridge's HTTP API where the routes themselves are the
// thing under test, and records what it was asked.
const seen = [];
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    seen.push({ method: req.method, path: req.url, body });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/tasks') return res.end(JSON.stringify({ id: 'task 1' }));
    if (req.url === '/v1/tasks/task%201/wait') {
      return res.end(JSON.stringify({ id: 'task 1', status: 'completed', steps: [] }));
    }
    if (req.url === '/v1/tools/call') return res.end(JSON.stringify({ ok: true, tool: body.tool }));
    res.statusCode = 404;
    return res.end(JSON.stringify({ error: `Unknown endpoint: ${req.method} ${req.url}` }));
  });
});
fake.listen(0, '127.0.0.1');
await once(fake, 'listening');
const fakePort = fake.address().port;

const servers = [];

try {
  await waitForServer(`http://127.0.0.1:${port}/health`);

  // 1. No socket, real bridge: every tool has to arrive as a request the
  //    bridge recognises. The fallback used to send `browser.snapshot` where
  //    the HTTP API takes `browser_snapshot`, so all ten came back
  //    "Unknown tool" and the fallback could never work.
  const overHttp = startMcp({ socket: noSocket, httpPort: port });
  await overHttp.request('initialize', {});
  const listed = await overHttp.request('tools/list', {});
  assert.deepEqual(listed.tools.map((tool) => tool.name), TOOL_CALLS.map(([name]) => name));
  for (const [name, args] of TOOL_CALLS) {
    const result = await overHttp.request('tools/call', { name, arguments: args });
    const text = result.content[0].text;
    assert.equal(result.isError, true, `${name} cannot succeed without an extension`);
    assert.match(text, /extension is not connected/i, `${name} over HTTP: ${text}`);
  }

  // 2. No socket, recording server: a goal is two requests, and neither is
  //    a tool call.
  const recorded = startMcp({ socket: noSocket, httpPort: fakePort });
  await recorded.request('initialize', {});
  const goal = await recorded.request('tools/call', {
    name: 'weboperator_execute_goal', arguments: { goal: 'read the page', timeoutMs: 5000 },
  });
  assert.notEqual(goal.isError, true, goal.content[0].text);
  assert.deepEqual(seen.map((entry) => `${entry.method} ${entry.path}`), [
    'POST /v1/tasks',
    'POST /v1/tasks/task%201/wait',
  ]);
  assert.deepEqual(seen[0].body, { goal: 'read the page', timeoutMs: 5000 });
  assert.deepEqual(seen[1].body, { timeoutMs: 5000 });

  seen.length = 0;
  const click = await recorded.request('tools/call', {
    name: 'browser_click', arguments: { index: 3 },
  });
  assert.notEqual(click.isError, true, click.content[0].text);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].path, '/v1/tools/call');
  assert.equal(seen[0].body.tool, 'browser_click');
  assert.equal(seen[0].body.arguments.index, 3);

  // 3. Socket open, bridge answers with an error: that error is the result.
  //    Falling back here replaced it with the second attempt's, and after a
  //    timeout would have run the action twice.
  seen.length = 0;
  const overSocket = startMcp({ socket: socketPath, httpPort: fakePort });
  await overSocket.request('initialize', {});
  const refused = await overSocket.request('tools/call', { name: 'browser_click', arguments: { index: 1 } });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /extension is not connected/i);
  assert.equal(seen.length, 0, 'an error from the bridge must not be retried over HTTP');

  console.log('MCP smoke tests passed');
} finally {
  for (const server of servers) await stopChild(server.child);
  await stopChild(bridge);
  fake.close();
}

function startMcp({ socket, httpPort }) {
  const child = spawn(process.execPath, ['weboperator-bridge/mcp-server.js'], {
    cwd: root,
    env: {
      ...process.env,
      WEBOPERATOR_AGENT_SOCKET: socket,
      WEBOPERATOR_BRIDGE_PORT: String(httpPort),
      WEBOPERATOR_API_TOKEN: token,
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const waiting = new Map();
  let nextId = 1;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    const settle = waiting.get(message.id);
    if (!settle) return;
    waiting.delete(message.id);
    if (message.error) settle.reject(new Error(message.error.message));
    else settle.resolve(message.result);
  });
  const server = {
    child,
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`No answer to ${method}`)), 15_000);
        waiting.set(id, {
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (err) => { clearTimeout(timer); reject(err); },
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
  };
  servers.push(server);
  return server;
}

async function waitForServer(url) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function stopChild(childProcess) {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return;
  const exited = once(childProcess, 'exit').catch(() => {});
  childProcess.kill('SIGTERM');
  await exited;
}
