import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, appendFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { csvRequest } = require('../weboperator-bridge/csv.js');

async function withCsv(content, run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'bridge-csv-'));
  try {
    const file = path.join(dir, 'orders.csv');
    await writeFile(file, content);
    await run(file, dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const ORDERS = '﻿id;country;note;zip\r\n'
  + '1;Spain;"Calle 5; piso 2";08001\r\n'
  + '2;France;plain;75001\r\n'
  + '3;Spain;"two\nlines and ""quotes""";00042\r\n'
  + '\r\n';

test('inspect reports headers, rows and the detected delimiter', async () => {
  await withCsv(ORDERS, async file => {
    const info = await csvRequest({ mode: 'inspect', file });
    assert.deepEqual(info.columns, ['id', 'country', 'note', 'zip']);
    assert.equal(info.rows, 3, 'the trailing blank line is not a row');
    assert.equal(info.delimiter, ';');
  });
});

test('transform filters, edits and writes a separate verified copy that keeps quoting, BOM and leading zeros', async () => {
  await withCsv(ORDERS, async (file, dir) => {
    const result = await csvRequest({ mode: 'transform', file,
      filters: [{ column: 'country', value: 'Spain' }],
      updates: [{ column: 'note', value: 'checked' }],
      columns: ['id', 'zip', 'note'] });
    assert.equal(result.inputRows, 3);
    assert.equal(result.outputRows, 2);
    assert.equal(result.columnCount, 3);
    assert.notEqual(result.path, file);
    assert.equal(await readFile(file, 'utf8'), ORDERS, 'the source download is untouched');
    assert.equal(await readFile(result.path, 'utf8'), '﻿id;zip;note\r\n1;08001;checked\r\n3;00042;checked\r\n');
    assert.deepEqual(await csvRequest({ mode: 'verify', file: result.path, sha256: result.sha256 }), { verified: true });

    const again = await csvRequest({ mode: 'transform', file,
      filters: [{ column: 'country', value: 'Spain' }],
      updates: [{ column: 'note', value: 'checked' }],
      columns: ['id', 'zip', 'note'] });
    assert.equal(again.path, result.path, 'a retry reuses the same output');
    assert.equal((await readdir(dir)).filter(name => name.endsWith('.csv')).length, 2, 'no temp or duplicate files remain');
  });
});

test('quoted fields keep embedded delimiters, newlines and quotes', async () => {
  await withCsv(ORDERS, async file => {
    const result = await csvRequest({ mode: 'transform', file, filters: [{ column: 'id', value: '3' }] });
    assert.equal(await readFile(result.path, 'utf8'),
      '﻿id;country;note;zip\r\n3;Spain;"two\nlines and ""quotes""";00042\r\n');
  });
});

test('verify catches a file changed after transform', async () => {
  await withCsv('a,b\n1,2\n', async file => {
    const result = await csvRequest({ mode: 'transform', file });
    await appendFile(result.path, '3,4\r\n');
    await assert.rejects(csvRequest({ mode: 'verify', file: result.path, sha256: result.sha256 }), /changed/);
  });
});

test('malformed input and unknown columns are rejected', async () => {
  await withCsv('a,b\n1,2,3\n', async file => {
    await assert.rejects(csvRequest({ mode: 'inspect', file }), /row width/);
  });
  await withCsv('a,a\n1,2\n', async file => {
    await assert.rejects(csvRequest({ mode: 'inspect', file }), /unique/);
  });
  await withCsv('a,b\n"1,2\n', async file => {
    await assert.rejects(csvRequest({ mode: 'inspect', file }), /Unclosed/);
  });
  await withCsv('a,b\n1,2\n', async file => {
    await assert.rejects(csvRequest({ mode: 'transform', file, filters: [{ column: 'missing', value: 'x' }] }), /Unknown column/);
    await assert.rejects(csvRequest({ mode: 'inspect', file: 'relative.csv' }), /downloaded CSV/);
    await assert.rejects(csvRequest({ mode: 'inspect', file: file.replace(/\.csv$/, '.txt') }), /downloaded CSV/);
  });
});
