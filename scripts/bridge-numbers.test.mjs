import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, copyFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { numbersRequest, checkCells } = require('../weboperator-bridge/numbers.js');

test('cell edits are validated and leading zeros are written as text', () => {
  assert.deepEqual(checkCells([{ cell: 'C3', value: '00042' }, { cell: 'A1', value: 7 }, { cell: 'B2', value: 'Spain' }]).map(c => c.asText), [true, false, false]);
  assert.equal(checkCells([{ cell: 'B2', value: '=SUM(A1)' }])[0].asText, true, 'formula-looking text stays text');
  assert.throws(() => checkCells([{ cell: 'b2', value: 'x' }]), /Invalid cell/);
  assert.throws(() => checkCells([{ cell: 'A1:B2', value: 'x' }]), /Invalid cell/);
  assert.throws(() => checkCells([{ cell: 'A1', value: { evil: true } }]), /string or number/);
  assert.throws(() => checkCells([]), /1-200/);
});

test('rejects paths that are not spreadsheets before starting Numbers', async () => {
  await assert.rejects(numbersRequest({ op: 'read', file: 'relative.xlsx' }), /absolute path|requires macOS/);
  await assert.rejects(numbersRequest({ op: 'read', file: '/etc/passwd' }), /absolute path|requires macOS/);
  await assert.rejects(numbersRequest({ op: 'read', file: '/tmp/orders.csv' }), /transform_csv|requires macOS/);
  await assert.rejects(numbersRequest({ op: 'verify', file: '/tmp/x.csv', sha256: 'a' }), /generated .xlsx/);
});

test('verify catches a changed copy', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bridge-numbers-'));
  try {
    const file = path.join(dir, 'copy.xlsx');
    await writeFile(file, 'abc');
    const sha = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    assert.deepEqual(await numbersRequest({ op: 'verify', file, sha256: sha }), { verified: true });
    await writeFile(file, 'abcd');
    await assert.rejects(numbersRequest({ op: 'verify', file, sha256: sha }), /changed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// Drives the real app: opt in with WEBOPERATOR_NUMBERS_TEST=/path/to/sheet.xlsx (first sheet, table 1, header row).
const sample = process.env.WEBOPERATOR_NUMBERS_TEST;
test('edits a copy in Numbers and verifies it', { skip: !(process.platform === 'darwin' && sample && existsSync('/Applications/Numbers.app')) }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bridge-numbers-'));
  try {
    const file = path.join(dir, 'sheet.xlsx');
    await copyFile(sample, file);
    const read = await numbersRequest({ op: 'read', file, maxRows: 3 });
    assert.ok(read.values.length > 0);
    const edited = await numbersRequest({ op: 'edit', file, cells: [{ cell: 'B2', value: 'WebOperator test' }, { cell: 'C2', value: '00042' }] });
    assert.equal(edited.verified, true);
    const back = await numbersRequest({ op: 'read', file: edited.path, maxRows: 3 });
    assert.equal(back.values[1][1], 'WebOperator test');
    assert.equal(back.values[1][2], '00042');
    assert.deepEqual((await readdir(dir)).filter(name => name.startsWith('.weboperator-')), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
