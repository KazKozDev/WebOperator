// Drives bridge.js over its real native-messaging framing (4-byte length + JSON on stdin/stdout).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const fake = fileURLToPath(new URL('./fixtures/fake-mcp-server.mjs', import.meta.url));

function frame(msg) {
  const body = Buffer.from(JSON.stringify(msg));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

test('bridge answers a framed mcp:request with one well-formed frame', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bridge-wire-'));
  const config = path.join(dir, 'connectors.json');
  await writeFile(config, JSON.stringify({ servers: { mail: { command: process.execPath, args: [fake] } } }));
  await chmod(config, 0o600);
  const port = 21000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['weboperator-bridge/bridge.js'], {
    cwd: root,
    env: { ...process.env, WEBOPERATOR_BRIDGE_PORT: String(port), WEBOPERATOR_AGENT_SOCKET: path.join(dir, 'agent.sock'),
      WEBOPERATOR_BRIDGE_PID_FILE: path.join(dir, 'bridge.pid'), WEBOPERATOR_BRIDGE_LOG: path.join(dir, 'bridge.log'), WEBOPERATOR_CONNECTORS: config },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  try {
    let raw = Buffer.alloc(0);
    const frames = [];
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no response; got ${raw.length} bytes`)), 15000);
      child.stdout.on('data', chunk => {
        raw = Buffer.concat([raw, chunk]);
        while (raw.length >= 4 && raw.length >= 4 + raw.readUInt32LE(0)) {
          const length = raw.readUInt32LE(0);
          frames.push(JSON.parse(raw.subarray(4, 4 + length).toString('utf8')));
          raw = raw.subarray(4 + length);
          if (frames.at(-1).kind === 'mcp:response') { clearTimeout(timer); resolve(frames.at(-1)); }
        }
      });
    });
    child.stdin.write(frame({ kind: 'bridge:hello' }));
    child.stdin.write(frame({ kind: 'mcp:request', id: 'r1', payload: { op: 'call', server: 'mail', tool: 'send_email', arguments: { to: 'a@example.test' } } }));
    const answer = await response;
    assert.equal(answer.id, 'r1');
    assert.equal(answer.error, undefined);
    assert.match(answer.result.text, /^send_email ok \{"to":"a@example.test"\}/);
    assert.equal(raw.length, 0, 'no stray bytes after the frame');
    assert.deepEqual(frames.map(f => f.kind), ['mcp:response']);

    child.stdin.write(frame({ kind: 'mcp:request', id: 'r2', payload: { op: 'call', server: 'nope', tool: 'x' } }));
    const failed = await new Promise(resolve => {
      const check = () => { const f = frames.find(item => item.id === 'r2'); if (f) resolve(f); else setTimeout(check, 20); };
      check();
    });
    assert.match(failed.error, /Unknown connector/);
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
