#!/usr/bin/env node
// WebOperator framed JSON client for agents.
const net = require('net');
const { randomUUID } = require('crypto');

const socketPath = process.env.WEBOPERATOR_AGENT_SOCKET || '/tmp/weboperator-bridge.sock';
const token = process.env.WEBOPERATOR_API_TOKEN || '';
const input = process.argv[2] ? JSON.parse(process.argv[2]) : { type: 'bridge.health' };
const message = {
  id: input.id || randomUUID(),
  type: input.type || 'bridge.health',
  payload: input.payload || {},
  timeoutMs: input.timeoutMs,
  ...(token ? { token } : {}),
};

let buffer = Buffer.alloc(0);
let nextFrameLength = null;
const socket = net.createConnection(socketPath, () => sendFrame(socket, message));

socket.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  readFrames();
});
socket.on('error', (err) => {
  console.error(err.message);
  process.exitCode = 1;
});

function readFrames() {
  while (true) {
    if (nextFrameLength === null) {
      if (buffer.length < 4) return;
      nextFrameLength = buffer.readUInt32LE(0);
      buffer = buffer.slice(4);
    }
    if (buffer.length < nextFrameLength) return;
    const payload = buffer.slice(0, nextFrameLength).toString('utf8');
    buffer = buffer.slice(nextFrameLength);
    nextFrameLength = null;
    const msg = JSON.parse(payload);
    if (msg.kind === 'event') {
      console.error(JSON.stringify(msg));
      continue;
    }
    console.log(JSON.stringify(msg, null, 2));
    socket.end();
  }
}

function sendFrame(sock, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  sock.write(Buffer.concat([header, body]));
}
