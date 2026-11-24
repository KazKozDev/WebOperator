// Numbers.app automation for downloaded spreadsheets (macOS). Each request is one
// osascript run: open → read or edit → export a copy → reopen the copy → read back.
// Values travel as a JSON argument, never as script text.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');

// CSV import drops leading zeros and adds a title row on export; .xls and .numbers are untested.
const SOURCE_TYPES = new Set(['.xlsx']);
const MAX_BYTES = 50_000_000;
const MAX_CELLS = 200;
const CELL = /^[A-Z]{1,3}[1-9][0-9]{0,6}$/;
const RUN_TIMEOUT_MS = 120_000;

const SCRIPT = String.raw`
function run(argv) {
  const req = JSON.parse(argv[0]);
  const app = Application('com.apple.iWork.Numbers');
  const isOpen = p => app.documents().some(d => { try { const f = d.file(); return f && f.toString() === p; } catch (e) { return false; } });
  if (isOpen(req.file)) throw new Error('WEBOPERATOR_ALREADY_OPEN');
  const opened = [];
  const sheetIndex = (doc, name) => {
    if (!name) return 0;
    const i = doc.sheets().findIndex(s => s.name() === name);
    if (i < 0) throw new Error('WEBOPERATOR_NOT_FOUND sheet ' + name);
    return i;
  };
  const tableIndex = (sheet, name) => {
    if (!name) return 0;
    const i = sheet.tables().findIndex(t => t.name() === name);
    if (i < 0) throw new Error('WEBOPERATOR_NOT_FOUND table ' + name);
    return i;
  };
  const read = c => ({ formatted: c.formattedValue(), value: c.value() });
  // open() can return null while an import is still running; find the new document by id.
  const openDoc = file => {
    const before = app.documents().map(d => d.id());
    let doc = app.open(Path(file));
    // Imported documents are untitled and named after the file; never take a user's new document.
    const stem = file.split('/').pop().replace(/\.[^.]+$/, '');
    for (let i = 0; !doc && i < 40; i++) {
      delay(0.5);
      doc = app.documents().find(d => !before.includes(d.id()) && d.name().startsWith(stem)) ?? null;
    }
    if (!doc) throw new Error('WEBOPERATOR_OPEN_FAILED');
    opened.push(doc);
    // An import can still be running: wait until its first table answers.
    for (let i = 0; i < 40; i++) {
      try { doc.sheets[0].tables[0].rowCount(); return doc; } catch (e) { delay(0.5); }
    }
    throw new Error('WEBOPERATOR_OPEN_FAILED');
  };
  try {
    const doc = openDoc(req.file);
    if (req.op === 'read') {
      const sheets = doc.sheets().map(s => ({ name: s.name(), tables: s.tables().map(t => ({ name: t.name(), rows: t.rowCount(), columns: t.columnCount() })) }));
      const si = sheetIndex(doc, req.sheet);
      const table = doc.sheets[si].tables[tableIndex(doc.sheets[si], req.table)];
      const rows = Math.min(table.rowCount(), req.maxRows);
      const columns = Math.min(table.columnCount(), 26);
      const values = [];
      for (let r = 0; r < rows; r++) values.push(table.rows[r].cells().slice(0, columns).map(c => c.formattedValue()));
      return JSON.stringify({ sheets, values });
    }
    const located = req.cells.map(cell => {
      const si = sheetIndex(doc, cell.sheet);
      return { si, ti: tableIndex(doc.sheets[si], cell.table), cell };
    });
    for (const { si, ti, cell } of located) {
      const target = doc.sheets[si].tables[ti].cells[cell.cell];
      if (cell.asText) target.format = 'text';
      target.value = cell.value;
    }
    app.export(doc, { to: Path(req.out), as: 'Microsoft Excel' });
    doc.close({ saving: 'no' });
    opened.pop();
    const copy = openDoc(req.out);
    const readback = located.map(({ si, ti, cell }) => {
      try { return read(copy.sheets[si].tables[ti].cells[cell.cell]); } catch (e) { return null; }
    });
    return JSON.stringify({ readback });
  } finally {
    for (const d of opened) { try { d.close({ saving: 'no' }); } catch (e) {} }
  }
}`;

function runScript(request) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', SCRIPT, JSON.stringify(request)], { timeout: RUN_TIMEOUT_MS, maxBuffer: 10_000_000 }, (error, stdout, stderr) => {
      if (!error) {
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Numbers returned an unreadable answer')); }
        return;
      }
      const detail = `${stderr || error.message}`;
      if (/WEBOPERATOR_ALREADY_OPEN/.test(detail)) reject(new Error(`${path.basename(request.file)} is open in Numbers. Close it first: WebOperator does not touch documents you have open.`));
      else if (/-1743|Not authori[sz]ed/i.test(detail)) reject(new Error('macOS blocked control of Numbers. Allow it in System Settings → Privacy & Security → Automation (for Google Chrome, which runs the bridge).'));
      else if (/WEBOPERATOR_NOT_FOUND (.+?)(?:\s*\(|$)/.test(detail)) reject(new Error(`Not found in the spreadsheet: ${/WEBOPERATOR_NOT_FOUND (.+?)(?:\s*\(|$)/.exec(detail)[1]}`));
      else if (/-1728|Can.t get/i.test(detail)) reject(new Error(`A cell, sheet or table in the request does not exist (${detail.trim().slice(0, 200)})`));
      else if (/WEBOPERATOR_OPEN_FAILED/.test(detail)) reject(new Error(`Numbers could not open ${path.basename(request.file)}`));
      else if (error.killed) reject(new Error('Numbers did not answer in time'));
      else reject(new Error(`Numbers automation failed: ${detail.trim().slice(0, 300)}`));
    });
  });
}

async function sha256Of(file) {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

async function checkSource(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !SOURCE_TYPES.has(path.extname(file).toLowerCase())) {
    throw new Error('Expected an absolute path to an .xlsx file. For CSV use transform_csv.');
  }
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_BYTES) throw new Error('The spreadsheet must be a regular file up to 50 MB');
}

function checkCells(cells) {
  if (!Array.isArray(cells) || !cells.length || cells.length > MAX_CELLS) throw new Error(`cells must list 1-${MAX_CELLS} edits`);
  return cells.map(item => {
    if (!item || typeof item.cell !== 'string' || !CELL.test(item.cell)) throw new Error(`Invalid cell address: ${item?.cell}`);
    if (typeof item.value !== 'string' && typeof item.value !== 'number') throw new Error(`Cell ${item.cell} needs a string or number value`);
    for (const key of ['sheet', 'table']) if (item[key] !== undefined && typeof item[key] !== 'string') throw new Error(`${key} must be a name`);
    // Numbers turns "00042" into 42 and "+34…" into a number unless the cell is text.
    const asText = typeof item.value === 'string' && (item.asText === true || /^(?:0\d|\+|=)/.test(item.value));
    return { cell: item.cell, value: item.value, sheet: item.sheet, table: item.table, asText };
  });
}

function matches(expected, actual) {
  if (!actual) return false;
  const text = String(expected);
  return actual.formatted === text || String(actual.value) === text ||
    (typeof expected === 'number' && Number(actual.value) === expected);
}

async function numbersRequest(payload = {}) {
  const { op, file } = payload;
  if (op === 'verify') {
    if (typeof file !== 'string' || !path.isAbsolute(file) || path.extname(file).toLowerCase() !== '.xlsx') throw new Error('Expected a generated .xlsx');
    if (await sha256Of(file) !== payload.sha256) throw new Error('The edited spreadsheet changed before attachment');
    return { verified: true };
  }
  if (process.platform !== 'darwin') throw new Error('Numbers automation requires macOS');
  await checkSource(file);
  if (op === 'read') {
    const maxRows = Math.min(Math.max(Number(payload.maxRows) || 20, 1), 100);
    const result = await runScript({ op: 'read', file, sheet: payload.sheet, table: payload.table, maxRows });
    // Numbers tables carry empty padding rows and columns.
    const values = result.values ?? [];
    while (values.length && values.at(-1).every(v => v === null || v === '')) values.pop();
    const width = Math.max(0, ...values.map(row => row.findLastIndex(v => v !== null && v !== '') + 1));
    return { sheets: result.sheets, values: values.map(row => row.slice(0, width)) };
  }
  if (op !== 'edit') throw new Error('Unknown Numbers operation');
  const cells = checkCells(payload.cells);
  const key = createHash('sha256').update(await sha256Of(file)).update(JSON.stringify(cells)).digest('hex').slice(0, 12);
  const base = path.basename(file, path.extname(file)).slice(0, 48);
  const destination = path.join(path.dirname(file), `${base}-edited-${key}.xlsx`);
  const published = await fs.lstat(destination).catch(() => null);
  if (published?.isFile()) {
    // Only verified copies are published under this name; a retry reuses it.
    return { name: path.basename(destination), path: destination, sha256: await sha256Of(destination), edited: cells.length, verified: true };
  }
  const temporary = path.join(path.dirname(file), `.weboperator-${randomUUID()}.xlsx`);
  try {
    const { readback } = await runScript({ op: 'edit', file, cells, out: temporary });
    const wrong = cells.flatMap((cell, i) => matches(cell.value, readback?.[i]) ? []
      : [`${cell.cell}: expected ${JSON.stringify(cell.value)}, file has ${JSON.stringify(readback?.[i]?.formatted ?? null)}`]);
    if (wrong.length) throw new Error(`The exported copy does not hold the requested values (${wrong.join('; ')})`);
    // A copy, not a hard link: Numbers tracks files by identity and will not reopen
    // the inode it just closed under the temporary name.
    const checked = await sha256Of(temporary);
    try { await fs.copyFile(temporary, destination, require('node:fs').constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (await sha256Of(destination) !== checked) throw new Error('Output filename already exists with different contents');
    return { name: path.basename(destination), path: destination, sha256: await sha256Of(destination), edited: cells.length, verified: true };
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

module.exports = { numbersRequest, checkCells };
