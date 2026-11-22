#!/usr/bin/env node
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const port = 19000 + Math.floor(Math.random() * 1000);
const token = 'test-token';
const base = `http://127.0.0.1:${port}`;
const socketPath = `/tmp/weboperator-bridge-smoke-${process.pid}.sock`;
const unauthPort = port + 2000;
const unauthBase = `http://127.0.0.1:${unauthPort}`;
const unauthSocketPath = `/tmp/weboperator-bridge-smoke-unauth-${process.pid}.sock`;

// Default start: no token and no bypass in the environment, so the bridge must fail closed
// on a token file it creates in HOME.
const defaultHome = mkdtempSync(path.join(tmpdir(), 'weboperator-home-'));
const cleanEnv = { ...process.env };
delete cleanEnv.WEBOPERATOR_API_TOKEN;
delete cleanEnv.WEBOPERATOR_ALLOW_UNAUTHENTICATED_BRIDGE;
const unauthChild = spawn(process.execPath, ['weboperator-bridge/bridge.js'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...cleanEnv,
    HOME: defaultHome,
    WEBOPERATOR_BRIDGE_PORT: String(unauthPort),
    WEBOPERATOR_AGENT_SOCKET: unauthSocketPath,
    WEBOPERATOR_BRIDGE_LOG: '/tmp/weboperator-bridge-smoke-unauth.log',
  },

  stdio: ['ignore', 'ignore', 'inherit'],
});

const child = spawn(process.execPath, ['weboperator-bridge/bridge.js'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    WEBOPERATOR_BRIDGE_PORT: String(port),
    WEBOPERATOR_AGENT_SOCKET: socketPath,
    WEBOPERATOR_BRIDGE_LOG: '/tmp/weboperator-bridge-smoke.log',
    WEBOPERATOR_API_TOKEN: token,
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

try {
  await waitForServer(`${unauthBase}/health`);
  assert.equal((await getJson(`${unauthBase}/health`)).authRequired, true);
  const unauthDenied = await fetch(`${unauthBase}/v1/browser/snapshot`);
  assert.equal(unauthDenied.status, 401);
  const noPreflight = await fetch(`${unauthBase}/v1/tools/call`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"tool":"browser_eval","arguments":{"expression":"1"}}' });
  assert.equal(noPreflight.status, 401);
  const tokenFile = path.join(defaultHome, '.weboperator', 'bridge-token');
  assert.equal(statSync(tokenFile).mode & 0o777, 0o600);
  const fileToken = readFileSync(tokenFile, 'utf8').trim();
  assert.match(fileToken, /^[0-9a-f]{64}$/);
  const withFileToken = await fetch(`${unauthBase}/v1/browser/snapshot`, { headers: { authorization: `Bearer ${fileToken}` } });
  assert.notEqual(withFileToken.status, 401);

  await waitForServer(`${base}/health`);

  const health = await getJson(`${base}/health`);
  assert.equal(health.ok, true);
  assert.equal(health.bridge, 'online');
  assert.equal(health.extension, 'offline');
  assert.equal(health.authRequired, true);

  const unauthorized = await fetch(`${base}/v1/browser/snapshot`);
  assert.equal(unauthorized.status, 401);

  const queryToken = await fetch(`${base}/v1/browser/snapshot?token=${token}`);
  assert.equal(queryToken.status, 401);

  const socketUnauthorized = await requestSocket({ type: 'bridge.health' });
  assert.match(socketUnauthorized.error, /token/i);

  const socketHealth = await requestSocket({ type: 'bridge.health', token });
  assert.equal(socketHealth.result.ok, true);
  assert.equal(socketHealth.result.extension, 'offline');
  assert.equal(socketHealth.result.authRequired, true);

  const authorizedOffline = await fetch(`${base}/v1/browser/snapshot`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(authorizedOffline.status, 500);
  assert.match((await authorizedOffline.text()), /extension is not connected/i);

  const sse = await fetch(`${base}/v1/tasks/smoke/events`, {
    headers: { 'x-weboperator-token': token },
  });
  assert.equal(sse.status, 200);
  assert.match(sse.headers.get('content-type') || '', /text\/event-stream/);
  const reader = sse.body.getReader();
  const first = await reader.read();
  const text = new TextDecoder().decode(first.value);
  assert.match(text, /: connected/);
  await reader.cancel();

  const toolsRes = await fetch(`${base}/v1/tools`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(toolsRes.status, 200);
  const { tools } = await toolsRes.json();
  assert.ok(Array.isArray(tools) && tools.length > 5);
  assert.ok(tools.some((t) => t.function.name === 'browser_navigate'));

  const mcpList = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(mcpList.status, 200);
  const mcpJson = await mcpList.json();
  assert.equal(mcpJson.id, 1);
  assert.ok(mcpJson.result.tools.some((t) => t.name === 'browser_snapshot'));

  console.log('Bridge smoke tests passed');

} finally {
  await stopChild(child);
  await stopChild(unauthChild);
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

async function getJson(url) {
  const res = await fetch(url);
  assert.equal(res.status, 200);
  return res.json();
}

function requestSocket(message) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = Buffer.alloc(0);
    let nextFrameLength = null;
    socket.on('connect', () => sendFrame(socket, { id: 'smoke', ...message }));
    socket.on('error', reject);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        if (nextFrameLength === null) {
          if (buffer.length < 4) return;
          nextFrameLength = buffer.readUInt32LE(0);
          buffer = buffer.slice(4);
        }
        if (buffer.length < nextFrameLength) return;
        const payload = buffer.slice(0, nextFrameLength).toString('utf8');
        socket.end();
        resolve(JSON.parse(payload));
        return;
      }
    });
  });
}

function sendFrame(socket, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  socket.write(Buffer.concat([header, body]));
}

async function stopChild(childProcess) {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return;
  const exited = once(childProcess, 'exit').catch(() => {});
  childProcess.kill('SIGTERM');
  await exited;
}
