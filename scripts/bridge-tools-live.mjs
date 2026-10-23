// Run against the installed native host after rebuilding and reloading the extension.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { TOOLS } = require('../weboperator-bridge/tools.js');
const endpoint = `http://127.0.0.1:${process.env.WEBOPERATOR_BRIDGE_PORT || 8765}/mcp`;
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6UAAAAABJRU5ErkJggg==';
const server = createServer((req, res) => {
  if (req.url === '/pixel.png') { res.setHeader('content-type', 'image/png'); return res.end(Buffer.from(pixel, 'base64')); }
  res.setHeader('content-type', 'text/html');
  res.end('<title>MCP tools acceptance</title><label>Country<select id="country"><option value="FR">France</option><option value="ES">Spain</option><option disabled value="XX">Disabled</option></select></label><img alt="Test pixel" src="/pixel.png" width="40" height="40">');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
let tabId, taskId;
let rpcId = 0;
try {
  const listed = await rpc('tools/list', {});
  assert.deepEqual(listed.tools.map(t => t.name), TOOLS.map(t => t.name));
  console.log(`PASS live MCP catalogue: ${listed.tools.length} tools`);
  ({ tabId } = await tool('tabs_open', { url: `http://127.0.0.1:${server.address().port}`, active: false }));
  await tool('browser_wait', { tabId, until: 'load' });
  await tool('browser_select_option', { tabId, selector: '#country', value: 'Spain' });
  assert.equal((await evaluate('document.querySelector("select").value')).value, 'ES');
  await assert.rejects(tool('browser_select_option', { tabId, selector: '#country', value: 'XX' }), /disabled/);
  console.log('PASS select by label; disabled option rejected');
  const { snapshot } = await tool('browser_snapshot', { tabId, includeImages: true, minImageArea: 0 });
  const image = snapshot.nodes.find(n => n.src?.includes('/pixel.png'));
  assert(image, 'image ref must be present');
  const media = await tool('browser_image', { tabId, ref: image.ref });
  assert.equal(media[0].type, 'image');
  assert.equal(media[0].mimeType, 'image/png');
  assert.equal(media[0].data, pixel);
  console.log('PASS browser_image returns native MCP image content');
  await tool('browser_handle_dialog', { tabId, action: 'status' });
  for (const [type, expression, action, promptText, expected] of [
    ['alert', 'alert("smoke alert"); window.dialogResult = true', 'accept', undefined, true],
    ['confirm', 'window.dialogResult = confirm("smoke confirm")', 'dismiss', undefined, false],
    ['prompt', 'window.dialogResult = prompt("smoke prompt", "default")', 'accept', 'answer', 'answer'],
  ]) {
    await evaluate(`setTimeout(() => { ${expression}; }, 100); true`);
    let dialog;
    for (let i = 0; i < 60; i++) {
      ({ dialog } = await tool('browser_handle_dialog', { tabId, action: 'status' }));
      if (dialog) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(dialog?.type, type);
    await tool('browser_handle_dialog', { tabId, action, ...(promptText === undefined ? {} : { promptText }) });
    assert.equal((await evaluate('window.dialogResult')).value, expected);
    console.log(`PASS ${type}: ${action}`);
  }
  await assert.rejects(tool('browser_handle_dialog', { tabId, action: 'accept' }), /No observed dialog/);
  const task = await tool('agent_task_start', { tabId, goal: 'Acceptance test. Do not navigate or click. Wait.', wait: false });
  taskId = task.taskId;
  assert(taskId);
  assert.equal((await tool('agent_task_pause', { id: taskId })).ok, true);
  assert.equal((await tool('agent_task_resume', { id: taskId })).ok, true);
  const current = await tool('agent_task_wait', { id: taskId, timeoutMs: 0 });
  assert.equal(current.id, taskId);
  await tool('agent_task_stop', { id: taskId });
  await assert.rejects(tool('agent_task_pause', { id: 'missing-task' }), /not found/i);
  console.log('PASS task pause/resume/wait and missing-task rejection');
} finally {
  if (taskId) await tool('agent_task_stop', { id: taskId }).catch(() => {});
  if (tabId) {
    await tool('browser_handle_dialog', { tabId, action: 'dismiss' }).catch(() => {});
    await tool('tabs_close', { tabIds: [tabId] }).catch(() => {});
  }
  server.closeAllConnections();
  server.close();
}
function evaluate(expression) { return tool('browser_eval', { tabId, expression }); }
async function rpc(method, params) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.WEBOPERATOR_API_TOKEN ? { authorization: `Bearer ${process.env.WEBOPERATOR_API_TOKEN}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }), signal: AbortSignal.timeout(40000) });
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
  const message = await response.json();
  if (message.error) throw new Error(message.error.message);
  return message.result;
}
async function tool(name, args) {
  const result = await rpc('tools/call', { name, arguments: args });
  if (result.isError) throw new Error(result.content[0].text);
  if (result.content[0].type === 'image') return result.content;
  const value = JSON.parse(result.content[0].text);
  const action = value?.kind === 'action:result' ? value.result : value;
  if (action?.ok === false) throw new Error(action.error ?? 'Action failed');
  return value;
}
