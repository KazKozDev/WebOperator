import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { prepareLocalRequest, completeLocalRequest, clipboardRequest } = require('../weboperator-bridge/local-files.js');

test('native file boundaries validate uploads and read actual download bytes with truncation', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bridge-files-'));
  try {
    const file = path.join(dir, 'sample.txt');
    await writeFile(file, 'downloaded locally');
    const prepared = await prepareLocalRequest('browser.upload_file', { path: file });
    assert.equal(prepared.fileName, 'sample.txt');
    assert.equal(prepared.fileSize, 18);
    await assert.rejects(prepareLocalRequest('browser.upload_file', { path: 'relative' }), /absolute/);
    await assert.rejects(prepareLocalRequest('browser.upload_file', { path: dir }), /regular/);
    const read = await completeLocalRequest('downloads.read', { maxBytes: 4 }, { path: file, state: 'complete', mime: 'text/plain' });
    assert.deepEqual(read, { kind: 'text', content: 'down', truncated: true, bytes: 4, mimeType: 'text/plain' });
    await assert.rejects(completeLocalRequest('downloads.read', {}, { path: file, state: 'in_progress' }), /not complete/);
    const output = path.join(dir, 'image.png');
    await completeLocalRequest('browser.screenshot', { saveTo: output }, { dataUrl: 'data:image/png;base64,YWJj' });
    assert.equal(await readFile(output, 'utf8'), 'abc');
    await assert.rejects(completeLocalRequest('browser.screenshot', { saveTo: output }, { dataUrl: 'data:image/png;base64,YWJj' }), /EEXIST/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('native clipboard handles write and read roundtrip with size boundary checks', { skip: process.platform !== 'darwin' }, async () => {
  assert.throws(() => clipboardRequest('clipboard.write', { text: 123 }), /string/);
  const orig = await clipboardRequest('clipboard.read');
  assert.equal(typeof orig.text, 'string');
  const writeRes = await clipboardRequest('clipboard.write', { text: 'test-clipboard-bytes' });
  assert.deepEqual(writeRes, { ok: true });
  const readBack = await clipboardRequest('clipboard.read');
  assert.equal(readBack.text, 'test-clipboard-bytes');
  await clipboardRequest('clipboard.write', { text: orig.text });
});
