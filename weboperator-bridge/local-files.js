const fs = require('node:fs/promises');
const path = require('node:path');

function absolutePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw new Error('An absolute filesystem path is required');
  return value;
}

async function prepareLocalRequest(type, payload) {
  if (type !== 'browser.upload_file') return payload;
  const filePath = absolutePath(payload.path);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error('Upload path must name a regular file');
  if (stat.size > 40 * 1024 * 1024) throw new Error('Upload file exceeds 40 MiB');
  return { ...payload, path: filePath, fileName: path.basename(filePath), fileSize: stat.size };
}

async function completeLocalRequest(type, payload, result) {
  if (type === 'browser.screenshot' && payload.saveTo) {
    const filePath = absolutePath(payload.saveTo);
    if (!result?.dataUrl?.match(/^data:image\/(png|jpeg);base64,/)) throw new Error('Extension returned no screenshot');
    await fs.writeFile(filePath, Buffer.from(result.dataUrl.split(',')[1], 'base64'), { flag: 'wx', mode: 0o600 });
    return { ...result, path: filePath };
  }
  if (type !== 'downloads.read') return result;
  if (!result || result.state !== 'complete') throw new Error('Download is not complete');
  const maxBytes = payload.maxBytes ?? 20000000;
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 20000000) throw new Error('maxBytes must be between 1 and 20000000');
  // The extension supplies the path from chrome.downloads by id; caller-supplied paths are never used.
  const handle = await fs.open(absolutePath(result.path), 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Downloaded path is not a regular file');
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
    let offset = 0;
    while (offset < buffer.length) { const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset); if (!bytesRead) break; offset += bytesRead; }
    const bytes = buffer.subarray(0, offset);
    const isText = /^(text\/)|json|xml|javascript|csv/.test(result.mime ?? '') || /\.(txt|md|csv|tsv|json|xml|html?|log)$/i.test(result.path);
    return { kind: isText ? 'text' : 'base64', content: bytes.toString(isText ? 'utf8' : 'base64'), truncated: stat.size > offset, bytes: offset, mimeType: result.mime };
  } finally { await handle.close(); }
}

module.exports = { prepareLocalRequest, completeLocalRequest };

function clipboardRequest(type, payload = {}) {
  if (type === 'clipboard.write' && (typeof payload.text !== 'string' || Buffer.byteLength(payload.text) > 1024 * 1024)) throw new Error('Clipboard text must be a string up to 1 MiB');
  const { spawn } = require('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn(type === 'clipboard.read' ? '/usr/bin/pbpaste' : '/usr/bin/pbcopy', [], { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = [];
    let bytes = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error('System clipboard timed out')); }, 5000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.stdin.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) { child.kill(); clearTimeout(timer); reject(new Error('Clipboard text exceeds 1 MiB')); }
      else chunks.push(chunk);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`System clipboard command failed: ${code}`));
      else resolve(type === 'clipboard.read' ? { text: Buffer.concat(chunks).toString('utf8') } : { ok: true });
    });
    child.stdin.end(type === 'clipboard.write' ? payload.text : undefined);
  });
}
module.exports.clipboardRequest = clipboardRequest;
