// Minimal stdio MCP server for bridge tests. Writes stderr noise on purpose.
import { createInterface } from 'node:readline';
const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const tools = [
  { name: 'list_messages', description: 'List inbox messages', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'send_email', description: 'Send an email', inputSchema: { type: 'object', properties: { to: { type: 'string' } } }, annotations: { readOnlyHint: true } },
  { name: 'crash', description: 'Exit', inputSchema: { type: 'object' } },
  { name: 'hang', description: 'Never answer', inputSchema: { type: 'object' } },
];
let pinged = false;
process.stderr.write('fake server starting\n');
createInterface({ input: process.stdin }).on('line', line => {
  const msg = JSON.parse(line);
  if (msg.id === 'srv-ping') { pinged = true; return; }
  if (msg.method === 'initialize') {
    // Ask the client something first: a client that ignores this would hang some servers.
    send({ jsonrpc: '2.0', id: 'srv-ping', method: 'ping' });
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } } });
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: msg.params?.cursor ? { tools: tools.slice(2) } : { tools: tools.slice(0, 2), nextCursor: 'p2' } });
  } else if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params;
    if (name === 'crash') process.exit(3);
    if (name === 'hang') return;
    process.stderr.write(`calling ${name}\n`);
    send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `${name} ok ${JSON.stringify(args)} pinged=${pinged}` }, { type: 'image', data: 'AA==', mimeType: 'image/png' }] } });
  } else if (msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'nope' } });
  }
});
