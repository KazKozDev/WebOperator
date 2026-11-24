// Operations on completed Chrome downloads, invoked only by the extension's
// native port. Paths are resolved by Chrome or taken from a verified artifact.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const MAX_BYTES = 20_000_000;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function readBytes(file) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('CSV must be a regular file up to 20 MB');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('CSV changed while reading');
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('CSV changed while reading');
    return bytes;
  } finally { await handle.close(); }
}

function detectDelimiter(text) {
  const counts = new Map([[',', 0], [';', 0], ['\t', 0]]);
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '\r' || c === '\n')) break;
    else if (!quoted && counts.has(c)) counts.set(c, counts.get(c) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

function parseCsv(text, delimiter) {
  const rows = [];
  let row = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else { quoted = false; closed = true; }
    } else if (c === delimiter) {
      row.push(cell); cell = ''; closed = false;
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = ''; closed = false;
    } else if (c === '"' && !cell && !closed) quoted = true;
    else if (closed || c === '"') throw new Error(`Invalid CSV quoting at row ${rows.length + 1}`);
    else cell += c;
  }
  if (quoted) throw new Error('Unclosed quoted CSV field');
  if (row.length || cell || closed) { row.push(cell); rows.push(row); }
  return rows;
}

function serializeRow(row, delimiter) {
  return row.map(value => value.includes(delimiter) || /["\r\n]/.test(value) || !value.length
    ? '"' + value.replaceAll('"', '""') + '"' : value).join(delimiter) + '\r\n';
}

function columnPairs(raw, header, label) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${label} must be an array`);
  return raw.map(pair => {
    if (!pair || typeof pair.column !== 'string' || typeof pair.value !== 'string') throw new Error(`Invalid ${label} column/value`);
    const index = header.indexOf(pair.column);
    if (index < 0) throw new Error(`Unknown column: ${pair.column}`);
    return [index, pair.value];
  });
}

async function csvRequest({ mode, file, filters, updates, columns, separator, sha256 }) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.csv$/i.test(file)) throw new Error('Expected a downloaded CSV');
  const bytes = await readBytes(file);
  const sourceHash = digest(bytes);
  if (mode === 'verify') {
    if (sourceHash !== sha256) throw new Error('The generated CSV changed before attachment');
    return { verified: true };
  }
  if (!['inspect', 'transform'].includes(mode)) throw new Error('Unknown CSV operation');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const delimiter = separator ?? detectDelimiter(text);
  if (![',', ';', '\t'].includes(delimiter)) throw new Error('Invalid CSV delimiter');
  const [header, ...parsed] = parseCsv(text, delimiter);
  // Exports often end with a blank line; a fully empty line is not a data row.
  const rows = header?.length > 1 ? parsed.filter(row => !(row.length === 1 && row[0] === '')) : parsed;
  if (!header?.length || header.some(h => !h.trim()) || new Set(header).size !== header.length) throw new Error('CSV needs unique nonempty column names');
  if (rows.some(row => row.length !== header.length)) throw new Error('CSV row width differs from the header');
  if (mode === 'inspect') {
    if (Buffer.byteLength(JSON.stringify(header)) > 100_000) throw new Error('CSV header is too large to inspect');
    return { columns: header, rows: rows.length, sample: rows.slice(0, 3).map(row => row.slice(0, 25).map(cell => cell.slice(0, 100))), delimiter };
  }
  const conditions = columnPairs(filters, header, 'filters');
  const edits = columnPairs(updates, header, 'updates');
  if (columns !== undefined && (!Array.isArray(columns) || !columns.length || new Set(columns).size !== columns.length || columns.some(c => !header.includes(c)))) throw new Error('columns must name unique existing columns');
  const selected = columns ?? header;
  const indices = selected.map(c => header.indexOf(c));
  const output = [selected];
  const lines = [serializeRow(selected, delimiter)];
  let length = Buffer.byteLength(lines[0]) + 3;
  for (const row of rows) {
    if (!conditions.every(([i, value]) => row[i] === value)) continue;
    for (const [i, value] of edits) row[i] = value;
    const result = indices.map(i => row[i]);
    const line = serializeRow(result, delimiter);
    length += Buffer.byteLength(line);
    if (length > MAX_BYTES) throw new Error('Generated CSV exceeds 20 MB');
    output.push(result); lines.push(line);
  }
  const bom = bytes.subarray(0, 3).equals(Buffer.from([239,187,191])) ? '\uFEFF' : '';
  const data = Buffer.from(bom + lines.join(''));
  const hash = digest(data);
  const base = path.basename(file, path.extname(file)).slice(0, 48);
  const destination = path.join(path.dirname(file), `${base}-filtered-${hash.slice(0, 12)}.csv`);
  const temporary = path.join(path.dirname(file), `.weboperator-${randomUUID()}.tmp`);
  await fs.writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
  try {
    // Publish only complete, verified files; retries reuse the same output.
    const check = await readBytes(temporary);
    if (digest(check) !== hash || !isDeepStrictEqual(parseCsv(new TextDecoder().decode(check), delimiter), output)) throw new Error('CSV output verification failed');
    try { await fs.link(temporary, destination); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (digest(await readBytes(destination)) !== hash) throw new Error('Output filename already exists with different contents');
  } finally { await fs.unlink(temporary); }
  return { name: path.basename(destination), path: destination, sha256: hash, inputRows: rows.length, outputRows: output.length - 1, columnCount: selected.length };
}

module.exports = { csvRequest };
