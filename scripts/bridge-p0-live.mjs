#!/usr/bin/env node
// Acceptance checks against an already loaded extension and its native bridge.
import assert from 'node:assert/strict';
import net from 'node:net';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

const socketPath = process.env.WEBOPERATOR_AGENT_SOCKET || '/tmp/weboperator-bridge.sock';
const token = process.env.WEBOPERATOR_API_TOKEN;
const rows = [];
let tabId;
let taskId;
let originalTab;
const fixture = createServer((req, res) => {
  if (req.url?.startsWith('/slow')) {
    return setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); }, req.url.endsWith('1') ? 800 : 1200);
  }
  if (req.url === '/frame') return res.end('<title>Child frame</title><button>Frame content</button>');
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><title>Bridge P0 acceptance</title><h1>Fixture</h1><button id="button" onclick="this.textContent=\'Clicked\'">Click test</button><iframe src="/frame"></iframe>');
});
fixture.listen(0, '127.0.0.1');
await once(fixture, 'listening');
const origin = `http://127.0.0.1:${fixture.address().port}`;
try {
  originalTab = (await call('tabs.current')).tabId;
  tabId = (await call('tabs.open', { url: origin, active: true })).tabId;
  await call('browser.wait', { tabId, until: 'load' });
  await check('tabs.open/list', async () => {
    const { tabs } = await call('tabs.list');
    assert.ok(tabs.some((tab) => tab.tabId === tabId && tab.url.startsWith(origin)));
  });
  await check('browser.wait load', async () => assert.equal((await call('browser.wait', { tabId, until: 'load' })).ok, true));
  await check('browser.eval 1+1', async () => assert.equal((await evaluate('1+1')).value, 2));
  await check('browser.eval exception', async () => assert.equal((await evaluate('throw new Error("acceptance")')).ok, false));
  await check('browser.eval awaitPromise', async () => assert.equal((await evaluate('Promise.resolve(42)')).value, 42));
  await check('browser.eval unresolved Promise timeout', async () => {
    const start = Date.now();
    const result = await call('browser.eval', { tabId, expression: 'new Promise(() => {})', timeoutMs: 100 });
    assert.equal(result.ok, false);
    assert.match(result.error, /timed out/);
    assert.ok(Date.now() - start < 2000);
    assert.equal((await evaluate('2+2')).value, 4, 'debugger must be detached after timeout');
  });
  await check('browser.eval child frame', async () => {
    const { snapshot } = await call('browser.snapshot', { tabId });
    const node = snapshot.nodes.find((node) => node.name === 'Frame content');
    assert.ok(node?.frameId);
    const result = await call('browser.eval', { tabId, frameId: node.frameId, expression: 'document.title' });
    assert.equal(result.value, 'Child frame', JSON.stringify(result));
  });
  await check('browser.wait SPA selector', async () => {
    await evaluate('setTimeout(() => {const p=document.createElement("p");p.id="ready";p.textContent="Ready now";document.body.append(p)}, 700); true');
    const result = await call('browser.wait', { tabId, until: 'element', selector: '#ready', timeoutMs: 3000, pollMs: 50 });
    assert.equal(result.ok, true);
    assert.ok(result.elapsedMs >= 400 && result.elapsedMs < 3000, JSON.stringify(result));
  });
  await check('browser.wait text/url/timeout', async () => {
    assert.equal((await call('browser.wait', { tabId, until: 'text', text: 'Ready now' })).ok, true);
    assert.equal((await call('browser.wait', { tabId, until: 'url', urlPattern: origin })).ok, true);
    assert.equal((await call('browser.wait', { tabId, until: 'text', text: 'missing', timeoutMs: 200 })).ok, false);
  });
  await check('browser.wait network_idle', async () => {
    await evaluate(`setTimeout(() => {fetch('/slow1'); fetch('/slow2')}, 250); true`);
    const result = await call('browser.wait', { tabId, until: 'network_idle', timeoutMs: 4000, pollMs: 50 });
    assert.equal(result.ok, true);
    assert.equal(result.source, 'network');
    assert.ok(result.elapsedMs >= 1200, JSON.stringify(result));
  });
  await check('index -> @eN', async () => {
    const { snapshot } = await call('browser.snapshot', { tabId });
    const node = snapshot.nodes.find((node) => node.name === 'Click test');
    assert.ok(node);
    await call('browser.click', { tabId, index: Number(node.ref.replace('@e', '')) });
    assert.equal((await evaluate('document.querySelector("#button").textContent')).value, 'Clicked');
  });
  await check('HTTP fallback preserves tabId/ref/amountPx', async () => {
    const toolCall = async (tool, args) => {
      const response = await fetch(`http://127.0.0.1:${process.env.WEBOPERATOR_BRIDGE_PORT || 8765}/v1/tools/call`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ tool, arguments: args }),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const result = await toolCall('browser_eval', { tabId, expression: 'document.title' });
    assert.equal((result.result ?? result).value, 'Bridge P0 acceptance');
    const response = await toolCall('browser_snapshot', { tabId });
    const snapshot = (response.result ?? response).snapshot;
    const node = snapshot.nodes.find((node) => node.name === 'Clicked');
    assert.ok(node);
    await toolCall('browser_click', { tabId, ref: node.ref });
    await toolCall('browser_scroll', { tabId, amountPx: 123, direction: 'down' });
  });
  await check('browser_scroll to=element and auto-scroll click/type visibility', async () => {
    const html = `<div style="height:2000px"></div><button id="bottom">Bottom target</button><input id="hidden-input">`;
    const inserted = await evaluate(`document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(html)}); true`);
    assert.equal(inserted.ok, true, JSON.stringify(inserted));
    const { snapshot } = await call('browser.snapshot', { tabId, allElements: true });
    const bottom = snapshot.nodes.find((node) => node.name === 'Bottom target');
    const input = snapshot.nodes.find((node) => node.role === 'textbox');
    assert.ok(bottom && input);
    const scrolled = await call('browser.scroll', { tabId, to: 'element', ref: bottom.ref, block: 'center' });
    assert.equal(scrolled.ok, true, JSON.stringify(scrolled));
    assert.ok(scrolled.scrollY > 0);
    await evaluate('window.scrollTo(0,0); true');
    await call('browser.click', { tabId, ref: bottom.ref });
    assert.ok((await evaluate('window.scrollY')).value > 0, 'click must scroll automatically');
    await evaluate('document.querySelector("#bottom").hidden = true; document.querySelector("#hidden-input").hidden = true; true');
    for (const [type, ref] of [['browser.click', bottom.ref], ['browser.type', input.ref]]) {
      const response = await call(type, { tabId, ref, text: 'must not be typed' });
      assert.equal(response.result.ok, false);
      assert.equal(response.result.error, 'Element not visible after scroll');
    }
    const response = await fetch(`http://127.0.0.1:${process.env.WEBOPERATOR_BRIDGE_PORT || 8765}/v1/tools/call`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ tool: 'browser_click', arguments: { tabId, ref: bottom.ref } }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Element not visible after scroll/);
  });
  await check('tabs.activate/current', async () => {
    await call('tabs.activate', { tabId });
    assert.equal((await call('tabs.current')).tabId, tabId);
  });
  await check('tasks.list limit', async () => assert.ok((await call('tasks.list', { limit: 1 })).length <= 1));
  await check('tasks.start/get/stop', async () => {
    const task = await call('tasks.start', { tabId, goal: 'Bridge acceptance smoke test. Do not navigate or click. Wait.', autoConfirm: false, wait: false });
    taskId = task.taskId;
    assert.ok(taskId);
    assert.equal((await call('tasks.stop', { id: taskId })).ok, true);
    const deadline = Date.now() + 20000;
    let current;
    do {
      current = await call('tasks.get', { id: taskId });
      if (current.status === 'stopped') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    assert.equal(current.status, 'stopped', `Task status: ${current.status}`);
    assert.ok(Array.isArray(current.steps));
  });
  await check('tasks.confirm rejects missing confirmation', async () => {
    await assert.rejects(call('tasks.confirm', { id: taskId, approve: false }), /not awaiting confirmation/);
  });
} finally {
  if (taskId) await call('tasks.stop', { id: taskId }).catch(() => {});
  if (tabId) await check('tabs.close', async () => assert.deepEqual((await call('tabs.close', { tabIds: [tabId] })).closed, [tabId]));
  if (originalTab) await call('tabs.activate', { tabId: originalTab }).catch(() => {});
  fixture.closeAllConnections();
  fixture.close();
  console.log(JSON.stringify(rows, null, 2));
}
if (rows.some((row) => row.status === 'FAIL')) process.exitCode = 1;

function evaluate(expression) { return call('browser.eval', { tabId, expression }); }
async function check(name, fn) {
  try { await fn(); rows.push({ name, status: 'PASS' }); }
  catch (error) { rows.push({ name, status: 'FAIL', error: error.message }); }
}
function call(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`Socket timeout: ${type}`)); }, 30000);
    let buffer = Buffer.alloc(0);
    const finish = (error, result) => { clearTimeout(timer); socket.destroy(); if (error) reject(error); else resolve(result); };
    socket.on('connect', () => {
      const body = Buffer.from(JSON.stringify({ id: randomUUID(), type, payload, timeoutMs: 25000, ...(token ? { token } : {}) }));
      const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
      socket.write(Buffer.concat([header, body]));
    });
    socket.on('error', (error) => finish(error));
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
        const length = buffer.readUInt32LE(0);
        const message = JSON.parse(buffer.subarray(4, 4 + length));
        buffer = buffer.subarray(4 + length);
        if (message.kind === 'event') continue;
        finish(message.error ? new Error(message.error) : null, message.result);
        return;
      }
    });
  });
}
