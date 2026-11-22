#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import net from 'node:net';
import { randomUUID } from 'node:crypto';

const socketPath = process.env.WEBOPERATOR_AGENT_SOCKET || '/tmp/weboperator-bridge.sock';
const token = process.env.WEBOPERATOR_API_TOKEN;
const rows = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const fixture = createServer((req, res) => {
  if (req.url === '/api/products') { res.setHeader('content-type', 'application/json'); return res.end('[{"title":"Book","price":12}]'); }
  if (req.url === '/image.png') { res.setHeader('content-type', 'image/png'); return res.end(png); }
  if (req.url === '/download.txt') { res.setHeader('content-type', 'text/plain'); res.setHeader('content-disposition', 'attachment; filename=bridge-smoke.txt'); return res.end('native downloaded bytes'); }
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><title>Bridge P1/P2 acceptance</title><style>body{margin:16px}button,input{margin:8px}#image{width:100px;height:100px}#drag{width:80px;height:80px;background:blue;position:relative}#drop{width:120px;height:80px;background:gray;margin:20px}#hover-menu{display:none}#hover:hover #hover-menu{display:block}</style>
    <article><h1>Test article</h1><p>Read <a href="/docs">documentation</a>.</p><div class="product"><span data-field="title">Book</span><span data-field="price">12</span></div></article>
    <button id="click" ondblclick="this.dataset.double='yes'" oncontextmenu="event.preventDefault();this.dataset.right='yes'" onclick="this.dataset.shift=String(event.shiftKey)">Mouse test</button>
    <label for="file">Upload file</label><input id="file" type="file">
    <div id="hover" style="width:180px;height:60px">Hover target<span id="hover-menu">Visible menu</span></div>
    <div id="drag">Drag target</div><div id="drop">Drop target</div>
    <a id="image-wrapper" href="/image.png"><img id="image" src="/image.png" alt="Content image"></a><div id="shadow-host"></div><div style="height:1800px"></div><button id="bottom">Bottom</button>
    <script>document.querySelector('#shadow-host').attachShadow({mode:'open'}).innerHTML='<button id="shadow-button" onclick="this.textContent=\\'Shadow clicked\\'">Shadow action</button>';const drag=document.querySelector('#drag');let moving=false;drag.addEventListener('mousedown',()=>moving=true);document.addEventListener('mousemove',event=>{if(moving){drag.dataset.moved='yes';drag.style.transform='translateX(10px)'}});document.addEventListener('mouseup',()=>moving=false);</script>`);
});
fixture.listen(0, '127.0.0.1');
await once(fixture, 'listening');
const origin = `http://127.0.0.1:${fixture.address().port}`;
const temp = await mkdtemp('/tmp/bridge-p1-');
let tabId, originalTab, clipboard, downloadPath;
const evaluate = async (expression) => {
  const result = await call('browser.eval', { tabId, expression });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};
const snapshot = (args = {}) => call('browser.snapshot', { tabId, allElements: true, ...args }).then((r) => r.snapshot);
try {
  originalTab = (await call('tabs.current')).tabId;
  tabId = (await call('tabs.open', { url: origin, active: true })).tabId;
  await call('browser.wait', { tabId, until: 'load' });
  await check('network_clear/list/get, persistent capture shared with eval', async () => {
    await call('network.clear', { tabId });
    await evaluate("fetch('/api/products').then(r=>r.json())");
    await call('browser.wait', { tabId, until: 'network_idle' });
    const { requests } = await call('network.list', { tabId, urlPattern: '/api/products', type: 'fetch' });
    assert.ok(requests.length);
    const body = await call('network.get', { tabId, requestId: requests.at(-1).requestId });
    assert.deepEqual(JSON.parse(body.body), [{ title: 'Book', price: 12 }]);
  });
  await check('console_list errors and warnings', async () => {
    await evaluate("console.error('bridge-p1-error');console.warn('bridge-p1-warning');true");
    const result = await call('console.list', { tabId, level: 'error' });
    assert.ok(result.entries.some((entry) => entry.text.includes('bridge-p1-error')));
    assert.ok(!result.entries.some((entry) => entry.text.includes('bridge-p1-warning')));
  });
  await check('cookies_set/get via CDP including HttpOnly', async () => {
    await call('cookies.set', { tabId, url: origin, name: 'bridge_smoke', value: 'test', httpOnly: true });
    const { cookies } = await call('cookies.get', { tabId, url: origin });
    assert.ok(cookies.some((cookie) => cookie.name === 'bridge_smoke' && cookie.value === 'test' && cookie.httpOnly));
    await call('cookies.set', { tabId, url: origin, name: 'bridge_smoke', value: '', expires: 1 });
  });
  await check('storage_get/set local and session', async () => {
    for (const kind of ['local', 'session']) {
      await call('storage.set', { tabId, kind, items: { smoke: kind } });
      assert.equal((await call('storage.get', { tabId, kind, keys: ['smoke'] })).items.smoke, kind);
    }
  });
  await check('snapshot maxNodes/total/truncated, filters, text, stable diff refs', async () => {
    const small = await snapshot({ maxNodes: 1 });
    assert.equal(small.nodes.length, 1); assert.ok(small.total > 1 && small.truncated);
    const filtered = await snapshot({ roles: ['button'], query: 'Mouse', text: true, refPrefix: 'test' });
    assert.equal(filtered.nodes.length, 1); assert.ok(filtered.nodes[0].text.includes('Mouse'));
    assert.ok(filtered.nodes[0].ref.startsWith('@test'));
    await call('browser.click', { tabId, ref: filtered.nodes[0].ref });
    await snapshot({ diff: true });
    await evaluate("document.querySelector('#click').textContent='Mouse changed';document.body.insertAdjacentHTML('beforeend','<button>New diff button</button>');true");
    const after = await snapshot({ diff: true });
    assert.ok(after.diff.added.some((node) => node.name === 'New diff button'));
    assert.ok(after.diff.changed.some((node) => node.name === 'Mouse changed'));
  });
  await check('snapshot includeImages + browser.image direct and parent refs', async () => {
    const state = await snapshot({ includeImages: true, minImageArea: 5000 });
    const img = state.nodes.find((node) => node.src?.endsWith('/image.png'));
    assert.ok(img && img.naturalWidth === 1);
    assert.ok((await call('browser.image', { tabId, ref: img.ref })).bytes > 0);
    const ref = await evaluate("document.querySelector('#image-wrapper').dataset.agentRef");
    assert.ok((await call('browser.image', { tabId, ref })).bytes > 0);
  });
  await check('snapshot shadow root and actionable shadow ref', async () => {
    const state = await snapshot({ shadow: true });
    const shadow = state.nodes.find((node) => node.name === 'Shadow action');
    assert.ok(shadow);
    await call('browser.click', { tabId, ref: shadow.ref });
    assert.equal(await evaluate("document.querySelector('#shadow-host').shadowRoot.querySelector('button').textContent"), 'Shadow clicked');
  });
  await check('browser_read Markdown and truncation', async () => {
    const result = await call('browser.read', { tabId, selector: 'article', format: 'markdown' });
    assert.ok(result.content.includes('# Test article') && result.content.includes(`[documentation](${origin}/docs)`));
    assert.equal((await call('browser.read', { tabId, maxChars: 5 })).truncated, true);
  });
  await check('browser_upload_file validates path and selects local bytes', async () => {
    const file = `${temp}/upload.txt`; await writeFile(file, 'upload content');
    const ref = await evaluate("document.querySelector('#file').dataset.agentRef");
    const result = await call('browser.upload_file', { tabId, ref, path: file });
    assert.equal(result.ok, true); assert.equal(result.size, 14);
    assert.equal(await evaluate("document.querySelector('#file').files[0].name"), 'upload.txt');
    await assert.rejects(call('browser.upload_file', { tabId, ref, path: '/nonexistent/bridge-upload' }), /ENOENT/);
  });
  await check('browser_download + downloads_list/read actual native file', async () => {
    const item = await call('browser.download', { url: `${origin}/download.txt`, filename: `bridge-smoke-${Date.now()}.txt`, saveAs: false, timeoutMs: 3000 }, 6000);
    assert.ok(item.downloadId);
    assert.ok((await call('downloads.list', {})).items.some((entry) => entry.id === item.downloadId));
    if (item.state === 'complete') {
      downloadPath = item.path;
      const result = await call('downloads.read', { downloadId: item.downloadId, maxBytes: 6 });
      assert.equal(result.content, 'native');
      assert.equal(result.truncated, true);
    } else {
      assert.equal(item.requiresUserAction, true);
    }
  });
  await check('browser_screenshot fullPage/ref/jpeg/saveTo', async () => {
    const full = await call('browser.screenshot', { tabId, fullPage: true, saveTo: `${temp}/full.png` });
    assert.ok(full.h > 1800); assert.equal((await readFile(full.path)).readUInt32BE(16), full.w);
    const ref = await evaluate("document.querySelector('#click').dataset.agentRef");
    const clipped = await call('browser.screenshot', { tabId, ref, format: 'jpeg', quality: 70, saveTo: `${temp}/element.jpg` });
    assert.ok(clipped.w > 0 && clipped.w < full.w); assert.equal((await readFile(clipped.path))[0], 255);
  });
  await check('browser_click double/right/modifiers + hover + drag', async () => {
    await snapshot();
    const ref = await evaluate("document.querySelector('#click').dataset.agentRef");
    await call('browser.click', { tabId, ref, clickCount: 2 });
    assert.equal(await evaluate("document.querySelector('#click').dataset.double"), 'yes');
    await call('browser.click', { tabId, ref, button: 'right' });
    assert.equal(await evaluate("document.querySelector('#click').dataset.right"), 'yes');
    await call('browser.click', { tabId, ref, modifiers: 'Shift' });
    assert.equal(await evaluate("document.querySelector('#click').dataset.shift"), 'true');
    // Hover/drag divs gain explicit roles so the accessibility snapshot exposes refs.
    await evaluate("for(const id of ['hover','drag','drop'])document.getElementById(id).setAttribute('role','button');true");
    await snapshot();
    const hover = await evaluate("document.querySelector('#hover').dataset.agentRef");
    await call('browser.hover', { tabId, ref: hover });
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#hover-menu')).display"), 'block');
    const from = await evaluate("document.querySelector('#drag').dataset.agentRef"), to = await evaluate("document.querySelector('#drop').dataset.agentRef");
    await call('browser.drag', { tabId, from, to, steps: 5 });
    assert.equal(await evaluate("document.querySelector('#drag').dataset.moved"), 'yes');
  });
  await check('clipboard_read/write round trip and restore', async () => {
    clipboard = (await call('clipboard.read', { tabId })).text;
    await call('clipboard.write', { tabId, text: 'bridge smoke clipboard' });
    assert.equal((await call('clipboard.read', { tabId })).text, 'bridge smoke clipboard');
    await call('clipboard.write', { tabId, text: clipboard }); clipboard = undefined;
  });
  await check('browser_extract schema with configured model and validation', async () => {
    const result = await call('browser.extract', { tabId, selector: '.product', instruction: 'Extract the single product title and price as an array. The product is Book at 12.', schema: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, price: { type: 'number' } }, required: ['title', 'price'], additionalProperties: false } } }, 140000);
    assert.deepEqual(result.data, [{ title: 'Book', price: 12 }]);
  });
} finally {
  if (clipboard !== undefined) await call('clipboard.write', { tabId, text: clipboard }).catch(() => {});
  if (tabId) await call('tabs.close', { tabIds: [tabId] }).catch(() => {});
  if (originalTab) await call('tabs.activate', { tabId: originalTab }).catch(() => {});
  if (downloadPath) await unlink(downloadPath);
  await rm(temp, { recursive: true, force: true });
  fixture.closeAllConnections(); fixture.close();
  console.log(JSON.stringify(rows, null, 2));
}
if (rows.some((row) => row.status === 'FAIL')) process.exitCode = 1;
async function check(name, fn) {
  console.log(`RUN ${name}`);
  try { await fn(); rows.push({ name, status: 'PASS' }); console.log(`PASS ${name}`); }
  catch (error) { rows.push({ name, status: 'FAIL', error: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
}
function call(type, payload = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`Socket timeout: ${type}`)); }, timeoutMs);
    let buffer = Buffer.alloc(0);
    const finish = (error, result) => { clearTimeout(timer); socket.destroy(); if (error) reject(error); else resolve(result); };
    socket.on('connect', () => {
      const body = Buffer.from(JSON.stringify({ id: randomUUID(), type, payload, timeoutMs: timeoutMs - 1000, ...(token ? { token } : {}) }));
      const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
      socket.write(Buffer.concat([header, body]));
    });
    socket.on('error', (error) => finish(error));
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
        const length = buffer.readUInt32LE(0); const message = JSON.parse(buffer.subarray(4, 4 + length)); buffer = buffer.subarray(4 + length);
        if (message.kind === 'event') continue;
        finish(message.error ? new Error(message.error) : null, message.result); return;
      }
    });
  });
}
