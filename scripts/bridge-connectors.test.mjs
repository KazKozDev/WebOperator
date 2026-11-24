import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createConnectors } = require('../weboperator-bridge/mcp-client.js');
const fake = fileURLToPath(new URL('./fixtures/fake-mcp-server.mjs', import.meta.url));

async function withConnectors(servers, run, mode = 0o600) {
  const dir = await mkdtemp(path.join(tmpdir(), 'bridge-mcp-'));
  const configPath = path.join(dir, 'connectors.json');
  await writeFile(configPath, JSON.stringify({ servers }));
  await chmod(configPath, mode);
  const logs = [];
  const connectors = createConnectors({ configPath, log: line => logs.push(line) });
  try { await run(connectors, logs); }
  finally { connectors.closeAll(); await rm(dir, { recursive: true, force: true }); }
}

const mail = { command: process.execPath, args: [fake], readOnly: ['list_messages'] };

test('lists configured servers without starting them', async () => {
  await withConnectors({ mail }, async connectors => {
    assert.deepEqual(await connectors.request({ op: 'servers' }), { servers: [{ name: 'mail', readOnly: ['list_messages'], tools: null }] });
  });
});

test('lists paginated tools; only the user config marks a tool read-only', async () => {
  await withConnectors({ mail }, async connectors => {
    const { tools } = await connectors.request({ op: 'tools', server: 'mail' });
    assert.deepEqual(tools.map(t => [t.name, t.readOnly]), [['list_messages', true], ['send_email', false], ['crash', false], ['hang', false]]);
  });
});

test('calls a tool, answers server requests, and keeps stderr in the log', async () => {
  await withConnectors({ mail }, async (connectors, logs) => {
    const result = await connectors.request({ op: 'call', server: 'mail', tool: 'send_email', arguments: { to: 'a@example.test' } });
    assert.equal(result.isError, false);
    assert.equal(result.text, 'send_email ok {"to":"a@example.test"} pinged=true');
    assert.deepEqual(result.otherContent, ['image']);
    assert.ok(logs.some(line => line.includes('calling send_email')));
    await assert.rejects(connectors.request({ op: 'call', server: 'mail', tool: 'rm_rf' }), /no tool rm_rf/);
    await assert.rejects(connectors.request({ op: 'call', server: 'other', tool: 'x' }), /Unknown connector/);
  });
});

test('a crashed server fails the call and restarts on the next one', async () => {
  await withConnectors({ mail }, async connectors => {
    await assert.rejects(connectors.request({ op: 'call', server: 'mail', tool: 'crash' }), /exited/);
    const result = await connectors.request({ op: 'call', server: 'mail', tool: 'list_messages' });
    assert.match(result.text, /list_messages ok/);
  });
});

test('a hanging call times out', async () => {
  await withConnectors({ mail }, async connectors => {
    await assert.rejects(connectors.request({ op: 'call', server: 'mail', tool: 'hang', timeoutMs: 1000 }), /timed out/);
  });
});

test('refuses a group-writable config and a missing command', async () => {
  await withConnectors({ mail }, async connectors => {
    await assert.rejects(connectors.request({ op: 'servers' }), /chmod 600/);
  }, 0o620);
  await withConnectors({ broken: { command: 'weboperator-no-such-binary' } }, async connectors => {
    await assert.rejects(connectors.request({ op: 'tools', server: 'broken' }), /not found: weboperator-no-such-binary/);
  });
});
