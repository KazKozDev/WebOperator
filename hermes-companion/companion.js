#!/usr/bin/env node
// Hermes Companion — Native Messaging Host
const LOG = '/tmp/hermes-companion.log';
function log(s) { try { require('fs').appendFileSync(LOG, new Date().toISOString().slice(11,23) + ' ' + s + '\n'); } catch {} }

process.stdin.resume();

// Read length-prefixed messages from extension
function readMsg() {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let need = 4;

    function onData(chunk) {
      buf = Buffer.concat([buf, chunk]);
      while (true) {
        if (need > 0 && buf.length >= 4) {
          need = buf.readUInt32LE(0);
          buf = buf.slice(4);
        }
        if (need > 0 && buf.length >= need) {
          const json = buf.slice(0, need).toString('utf8');
          buf = buf.slice(need);
          need = 4;
          try {
            resolve(JSON.parse(json));
          } catch(e) {
            reject(e);
          }
          return;
        }
        break;
      }
    }

    process.stdin.on('data', onData);
    process.stdin.once('end', () => reject(new Error('EOF')));
    process.stdin.once('error', reject);
  });
}

function sendMsg(obj) {
  const json = JSON.stringify(obj);
  const buf = Buffer.from(json, 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(buf.length, 0);
  process.stdout.write(Buffer.concat([head, buf]));
}

// HTTP helpers
function httpGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, 'http://127.0.0.1:8642');
    require('http').get({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      timeout: 5000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(body); } });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

function httpPost(path, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, 'http://127.0.0.1:8642');
    const body = JSON.stringify(payload);
    const req = require('http').request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    req.on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

const TOOLS = [
  { type: 'function', function: { name: 'navigate', description: 'Navigate to URL', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'click', description: 'Click element', parameters: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] } } },
  { type: 'function', function: { name: 'type', description: 'Type text', parameters: { type: 'object', properties: { ref: { type: 'string' }, text: { type: 'string' } }, required: ['ref', 'text'] } } },
  { type: 'function', function: { name: 'scroll', description: 'Scroll page', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'extract', description: 'Extract page data', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'snapshot', description: 'Get page snapshot', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'done', description: 'Task complete', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } } },
];

async function main() {
  log('ready pid=' + process.pid);
  while (true) {
    log('waiting');
    const msg = await readMsg();
    log('← ' + msg.kind);

    if (msg.kind === 'hermes:poll') {
      try {
        await httpGet('/health');
        sendMsg({ kind: 'hermes:idle' });
        log('→ hermes:idle (online)');
      } catch {
        sendMsg({ kind: 'hermes:error', error: 'Hermes unreachable' });
        log('→ hermes:error (unreachable)');
      }
    } else if (msg.kind === 'hermes:context') {
      try {
        const data = await httpPost('/v1/responses', {
          model: 'hermes-3',
          messages: [
            { role: 'system', content: 'You are a browser agent. Use the tools provided. One tool call per response.' },
            { role: 'user', content: `Goal: ${msg.goal}\nPage context: ${msg.context}` },
          ],
          tools: TOOLS,
          temperature: 0.2,
        });
        const tc = (data?.choices?.[0]?.message?.tool_calls || [])[0];
        if (tc) {
          const fn = tc.function;
          const args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : (fn.arguments || {});
          sendMsg({ kind: 'hermes:command', tool: fn.name, arguments: args, commandId: tc.id || '0' });
          log('→ command: ' + fn.name);
        } else {
          sendMsg({ kind: 'hermes:idle' });
          log('→ hermes:idle (no tool call)');
        }
      } catch (e) {
        sendMsg({ kind: 'hermes:error', error: e.message });
        log('→ error: ' + e.message);
      }
    } else if (msg.kind === 'hermes:result') {
      sendMsg({ kind: 'hermes:ack' });
      log('→ ack');
    }
  }
}

main().catch(e => {
  log('FATAL: ' + (e && e.message || 'unknown'));
  process.exit(1);
});
