import type { A11ySnapshot, ActionResult, ToolCall } from '@/lib/types';

type Debuggee = { tabId: number };

interface GoogleSheetsGridMetrics {
  left: number;
  top: number;
  width: number;
  height: number;
  rowHeaderWidth: number;
  colHeaderHeight: number;
  cellWidth: number;
  cellHeight: number;
  visibleCols: number;
  visibleRows: number;
}

export async function runCdpAction(tabId: number, snapshot: A11ySnapshot, call: ToolCall): Promise<ActionResult> {
  const started = performance.now();
  if (!chrome.debugger?.attach) {

    return {
      ok: false,
      durationMs: performance.now() - started,
      error: 'Chrome debugger API is unavailable or permission was not granted',
    };
  }

  const target: Debuggee = { tabId };
  let attached = false;
  let extracted: unknown;

  try {

    await chrome.debugger.attach(target, '1.3');
    attached = true;
    await applyStealthPatches(target);
    await send(target, 'Runtime.evaluate', { expression: 'document.activeElement && document.activeElement.blur()' });


    if (call.name === 'click') {
      await cdpClick(target, snapshot, String(call.arguments.ref ?? ''));
    } else if (call.name === 'type') {
      await cdpType(
        target,
        snapshot,
        String(call.arguments.ref ?? ''),
        String(call.arguments.text ?? ''),
        String(call.arguments.submit ?? 'false') === 'true',
      );
    } else if (call.name === 'press') {
      if (call.arguments.ref) await cdpClick(target, snapshot, String(call.arguments.ref));
      await cdpPress(target, String(call.arguments.key ?? ''), String(call.arguments.modifiers ?? ''));
    } else if (call.name === 'upload_attachment') {
      await cdpUploadAttachment(
        target,
        snapshot,
        String(call.arguments.ref ?? ''),
        String(call.arguments.path ?? ''),
      );
    } else if (call.name === 'paste_table') {
      await cdpPasteTable(
        target,
        snapshot,
        typeof call.arguments.ref === 'string' ? call.arguments.ref : undefined,
        String(call.arguments.tsv ?? ''),
      );
    } else if (call.name === 'fill_cells') {
      extracted = await cdpFillCells(
        target,
        snapshot,
        String(call.arguments.tsv ?? ''),
        String(call.arguments.startCell ?? 'A1'),
      );
    } else if (call.name === 'select_cell') {
      await cdpSelectCell(target, snapshot, String(call.arguments.cell ?? ''));
    } else if (call.name === 'set_cell') {
      await cdpSetCell(
        target,
        snapshot,
        String(call.arguments.cell ?? ''),
        String(call.arguments.value ?? ''),
      );
    } else if (call.name === 'read_cells') {
      extracted = await cdpReadCells(
        target,
        snapshot,
        String(call.arguments.range ?? ''),
      );
    } else {
      throw new Error(`CDP action does not support ${call.name}`);
    }

    return { ok: true, durationMs: performance.now() - started, ...(extracted !== undefined ? { extracted } : {}) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: performance.now() - started,
    };
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => {});
  }
}

async function cdpUploadAttachment(target: Debuggee, snapshot: A11ySnapshot, ref: string, filePath: string): Promise<void> {
  if (!filePath) throw new Error('Attachment path is unavailable');
  const node = snapshot.nodes.find((candidate) => candidate.ref === ref);
  if (!node) throw new Error(`Element ${ref} not found in current snapshot`);
  const selector = `[data-agent-ref="${ref.replace(/["\\]/g, '\\$&')}"]`;
  const evaluated = await send<{ result?: { objectId?: string } }>(target, 'Runtime.evaluate', {
    expression: `(() => {
      const anchor = document.querySelector(${JSON.stringify(selector)});
      if (!anchor) return null;
      if (anchor instanceof HTMLInputElement && anchor.type === 'file') return anchor;
      if (anchor instanceof HTMLLabelElement && anchor.htmlFor) {
        const labelled = document.getElementById(anchor.htmlFor);
        if (labelled instanceof HTMLInputElement && labelled.type === 'file') return labelled;
      }
      const nearby = anchor.parentElement?.querySelector('input[type="file"]');
      if (nearby) return nearby;
      const inputs = document.querySelectorAll('input[type="file"]');
      return inputs.length === 1 ? inputs[0] : null;
    })()`,
    objectGroup: 'weboperator-upload',
  });
  const objectId = evaluated?.result?.objectId;
  if (!objectId) throw new Error(`File input ${ref} is not available in the page DOM`);
  const described = await send<{ node?: { backendNodeId?: number } }>(target, 'DOM.describeNode', { objectId });
  const backendNodeId = described?.node?.backendNodeId;
  if (!backendNodeId) throw new Error(`Could not resolve file input ${ref}`);
  await send(target, 'DOM.setFileInputFiles', { files: [filePath], backendNodeId });
  await send(target, 'Runtime.releaseObjectGroup', { objectGroup: 'weboperator-upload' }).catch(() => {});
  await sleep(100);
}

async function cdpClick(target: Debuggee, snapshot: A11ySnapshot, ref: string): Promise<void> {
  const point = centerOf(snapshot, ref);
  await send(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await send(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await send(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await sleep(80);
}

async function cdpType(target: Debuggee, snapshot: A11ySnapshot, ref: string, text: string, submit: boolean): Promise<void> {
  await cdpClick(target, snapshot, ref);
  await selectAll(target);
  await key(target, 'Backspace');
  await dispatchText(target, text);
  if (submit) await key(target, 'Enter');
  await sleep(80);
}

async function cdpPress(target: Debuggee, keyName: string, modifiersText: string): Promise<void> {
  const modifiers = cdpModifiers(modifiersText);
  const normalizedKey = normalizeKey(keyName);
  await key(target, normalizedKey, modifiers);
  await sleep(80);
}

async function dispatchText(target: Debuggee, text: string): Promise<void> {
  for (const ch of text) {
    await send(target, 'Input.dispatchKeyEvent', {
      type: 'char',
      text: ch,
      unmodifiedText: ch,
      key: ch,
      windowsVirtualKeyCode: ch.length === 1 ? ch.toUpperCase().charCodeAt(0) : undefined,
    });
    await sleep(2);
  }
}

async function cdpPasteTable(target: Debuggee, snapshot: A11ySnapshot, ref: string | undefined, tsv: string): Promise<void> {
  if (!tsv.trim()) throw new Error('paste_table requires non-empty TSV');
  if (isGoogleSheet(snapshot.url)) {
    await selectGoogleSheetsA1(target, snapshot);
  }
  if (ref) {
    await cdpClick(target, snapshot, ref);
  } else {
    await send(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(snapshot.viewport.w / 2),
      y: Math.round(snapshot.viewport.h / 2),
    });
    await send(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: Math.round(snapshot.viewport.w / 2),
      y: Math.round(snapshot.viewport.h / 2),
      button: 'left',
      clickCount: 1,
    });
    await send(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: Math.round(snapshot.viewport.w / 2),
      y: Math.round(snapshot.viewport.h / 2),
      button: 'left',
      clickCount: 1,
    });
  }

  await sleep(120);
  await writeClipboardInPage(target, snapshot.url, tsv);
  await shortcut(target, 'V', 4);
  await sleep(700);

  if (isGoogleSheet(snapshot.url)) {
    const pasted = await copySelectionToClipboard(target, snapshot.url);
    if (!clipboardLooksLikeTable(pasted, tsv)) {
      throw new Error('paste_table sent TSV but Google Sheets did not expose the pasted table on copy; select A1/grid and retry');
    }
  }
}

async function cdpFillCells(target: Debuggee, snapshot: A11ySnapshot, tsv: string, startCell: string): Promise<{
  writtenCells: string[];
  verificationWarning?: string;
}> {
  if (!tsv.trim()) throw new Error('fill_cells requires non-empty TSV');
  if (!isGoogleSheet(snapshot.url)) throw new Error('fill_cells currently supports Google Sheets only');

  const rows = parseTsv(tsv);
  if (rows.length === 0) throw new Error('fill_cells TSV has no rows');

  const origin = parseCell(startCell || 'A1');
  const writtenCells: string[] = [];

  // Build full TSV for single paste
  const cleanTsv = rows.map((r) => r.join('\t')).join('\n');

  // Try range select via name box first
  const endCell = `${columnName(origin.col + Math.max(...rows.map((r) => r.length)) - 1)}${origin.row + rows.length - 1}`;
  const range = `${startCell || 'A1'}:${endCell}`;
  const rangeSelected = await trySelectSheetsRange(target, snapshot, range);

  if (rangeSelected) {
    // Range selected — single paste for entire table
    await writeClipboardInPage(target, snapshot.url, cleanTsv);
    await shortcut(target, 'V', 4);
    await sleep(400);

    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        writtenCells.push(`${columnName(origin.col + c)}${origin.row + r}`);
      }
    }
  } else {
    // Fallback: cell-by-cell via name box (reliable)
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const value = rows[r][c];
        const cell = `${columnName(origin.col + c)}${origin.row + r}`;
        await selectGoogleSheetsCell(target, cell, snapshot);
        await key(target, 'Delete');
        if (value) {
          await writeClipboardInPage(target, snapshot.url, value);
          await shortcut(target, 'V', 4);
        }
        writtenCells.push(cell);
      }
    }
    await sleep(100);
  }

  if (writtenCells.length === 0) throw new Error('fill_cells did not write any cells');
  let verificationWarning: string | undefined;
  try {
    await verifyFilledCells(target, snapshot.url, rows, origin);
  } catch (err) {
    verificationWarning = err instanceof Error ? err.message : String(err);
  }
  await selectGoogleSheetsCell(target, startCell || 'A1', snapshot);
  return { writtenCells, ...(verificationWarning ? { verificationWarning } : {}) };
}

async function cdpSelectCell(target: Debuggee, snapshot: A11ySnapshot, cell: string): Promise<void> {
  if (!isGoogleSheet(snapshot.url)) throw new Error('select_cell currently supports Google Sheets only');
  await selectGoogleSheetsCell(target, cell, snapshot);
}

async function cdpSetCell(target: Debuggee, snapshot: A11ySnapshot, cell: string, value: string): Promise<void> {
  if (!isGoogleSheet(snapshot.url)) throw new Error('set_cell currently supports Google Sheets only');
  await selectGoogleSheetsCell(target, cell, snapshot);
  await key(target, 'Delete');
  if (value) {
    await writeClipboardInPage(target, snapshot.url, value);
    await shortcut(target, 'V', 4);
    await sleep(100);
  }
  const actual = normalizeCellText(await copySelectionToClipboard(target, snapshot.url));
  if (actual !== normalizeCellText(value)) {
    throw new Error(`set_cell verification failed at ${cell}: expected "${value}", got "${actual}"`);
  }
}

async function cdpReadCells(target: Debuggee, snapshot: A11ySnapshot, range: string): Promise<{ range: string; cells: string[][] }> {
  if (!isGoogleSheet(snapshot.url)) throw new Error('read_cells currently supports Google Sheets only');

  const rangeSelected = await trySelectSheetsRange(target, snapshot, range);
  if (!rangeSelected) {
    // Fallback: select via name box + Enter
    await clickGoogleSheetsNameBox(target, snapshot);
    await selectAll(target);
    await dispatchText(target, range);
    await sleep(60);
    await key(target, 'Enter');
    await sleep(300);
  }

  await shortcut(target, 'C', 4);
  await sleep(300);
  const raw = await copySelectionToClipboard(target, snapshot.url);

  if (!raw.trim()) throw new Error(`read_cells: no data in range ${range}`);

  const rows = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((row) => row.length > 0)
    .map((row) => row.split('\t').map((cell) => cell.trim()));

  return { range, cells: rows };
}

async function writeClipboardInPage(target: Debuggee, url: string, text: string): Promise<void> {
  const origin = new URL(url).origin;
  await send(target, 'Browser.grantPermissions', {
    origin,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  }).catch(() => {});
  const expression = `navigator.clipboard.writeText(${JSON.stringify(text)})`;
  const result = await send<{ exceptionDetails?: unknown }>(target, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error('Could not write TSV to clipboard from page context');
}

async function readClipboardInPage(target: Debuggee, url: string): Promise<string> {
  const origin = new URL(url).origin;
  await send(target, 'Browser.grantPermissions', {
    origin,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  }).catch(() => {});
  const result = await send<{ result?: { value?: string }; exceptionDetails?: unknown }>(target, 'Runtime.evaluate', {
    expression: 'navigator.clipboard.readText()',
    awaitPromise: true,
    userGesture: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error('Could not read clipboard from page context');
  return result.result?.value ?? '';
}

async function copySelectionToClipboard(target: Debuggee, url: string): Promise<string> {
  await shortcut(target, 'C', 4);
  await sleep(250);
  return readClipboardInPage(target, url);
}

async function verifyFilledCells(
  target: Debuggee,
  url: string,
  rows: string[][],
  origin: { col: number; row: number },
): Promise<void> {
  const probes: Array<{ cell: string; expected: string }> = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const expected = rows[r][c];
      if (!expected) continue;
      if (
        probes.length === 0 ||
        (r === 0 && c === rows[r].length - 1) ||
        (r === rows.length - 1 && c === 0) ||
        (r === rows.length - 1 && c === rows[r].length - 1)
      ) {
        probes.push({
          cell: `${columnName(origin.col + c)}${origin.row + r}`,
          expected,
        });
      }
    }
  }

  for (const probe of probes.slice(0, 4)) {
    await selectGoogleSheetsCell(target, probe.cell);
    const actual = normalizeCellText(await copySelectionToClipboard(target, url));
    if (actual !== normalizeCellText(probe.expected)) {
      throw new Error(`fill_cells verification failed at ${probe.cell}: expected "${probe.expected}", got "${actual}"`);
    }
  }
}

async function selectGoogleSheetsA1(target: Debuggee, snapshot: A11ySnapshot): Promise<void> {
  await send(target, 'Runtime.evaluate', {
    expression: `
      (() => {
        const url = new URL(location.href);
        if (!url.hash.includes('range=')) {
          const gid = new URLSearchParams(url.hash.replace(/^#/, '')).get('gid') || '0';
          location.hash = 'gid=' + gid + '&range=A1';
        }
      })()
    `,
  }).catch(() => {});
  await sleep(500);
  await send(target, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: Math.max(70, Math.round(snapshot.viewport.w * 0.08)),
    y: Math.max(185, Math.round(snapshot.viewport.h * 0.24)),
  });
  await send(target, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: Math.max(70, Math.round(snapshot.viewport.w * 0.08)),
    y: Math.max(185, Math.round(snapshot.viewport.h * 0.24)),
    button: 'left',
    clickCount: 1,
  });
  await send(target, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: Math.max(70, Math.round(snapshot.viewport.w * 0.08)),
    y: Math.max(185, Math.round(snapshot.viewport.h * 0.24)),
    button: 'left',
    clickCount: 1,
  });
  await sleep(200);
}

async function selectGoogleSheetsCell(target: Debuggee, cell: string, snapshot?: A11ySnapshot): Promise<void> {
  const normalized = normalizeCellRef(cell);
  if (snapshot) {
    const selectedByGrid = await clickVisibleGoogleSheetsCell(target, snapshot, normalized);
    if (selectedByGrid) {
      await sleep(80);
      return;
    }
  }

  const selectedByNameBox = await trySelectGoogleSheetsNameBox(target, normalized);
  if (selectedByNameBox) {
    await sleep(120);
    return;
  }

  if (snapshot) {
    await clickGoogleSheetsNameBox(target, snapshot);
    await selectAll(target);
    await dispatchText(target, normalized);
    await key(target, 'Enter');
    await sleep(180);
    return;
  }

  await send(target, 'Runtime.evaluate', {
    expression: `
      (() => {
        const url = new URL(location.href);
        const gid = new URLSearchParams(url.hash.replace(/^#/, '')).get('gid') || '0';
        location.hash = 'gid=' + gid + '&range=${normalized}';
      })()
    `,
  });
  await sleep(180);
}

async function clickVisibleGoogleSheetsCell(target: Debuggee, snapshot: A11ySnapshot, cell: string): Promise<boolean> {
  const parsed = parseCell(cell);
  const metrics = await googleSheetsGridMetrics(target);
  const grid = metrics ?? fallbackGridMetrics(snapshot);
  const colOffset = parsed.col - 1;
  const rowOffset = parsed.row - 1;

  if (colOffset < 0 || rowOffset < 0) return false;
  if (colOffset > grid.visibleCols || rowOffset > grid.visibleRows) return false;

  const x = Math.round(grid.left + grid.rowHeaderWidth + colOffset * grid.cellWidth + grid.cellWidth / 2);
  const y = Math.round(grid.top + grid.colHeaderHeight + rowOffset * grid.cellHeight + grid.cellHeight / 2);

  if (x < 0 || y < 0 || x > snapshot.viewport.w || y > snapshot.viewport.h) return false;

  await send(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(60);
  return true;
}

async function googleSheetsGridMetrics(target: Debuggee): Promise<GoogleSheetsGridMetrics | null> {
  const result = await send<{ result?: { value?: GoogleSheetsGridMetrics | null } }>(target, 'Runtime.evaluate', {
    expression: `
      (() => {
        const selectors = [
          '#waffle-grid-container',
          '#grid-table-container',
          '.waffle-grid-container',
          '.grid-table-container',
          '[class*="waffle-grid"]',
          '[class*="grid-container"]'
        ];
        const el = selectors.map((s) => document.querySelector(s)).find(Boolean);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        return {
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
          rowHeaderWidth: 46,
          colHeaderHeight: 24,
          cellWidth: 100,
          cellHeight: 21,
          visibleCols: Math.floor((r.width - 46) / 100),
          visibleRows: Math.floor((r.height - 24) / 21)
        };
      })()
    `,
    returnByValue: true,
  }).catch(() => undefined);
  return result?.result?.value ?? null;
}

function fallbackGridMetrics(snapshot: A11ySnapshot): GoogleSheetsGridMetrics {
  return {
    left: 0,
    top: Math.max(150, Math.round(snapshot.viewport.h * 0.19)),
    width: snapshot.viewport.w,
    height: snapshot.viewport.h - Math.max(150, Math.round(snapshot.viewport.h * 0.19)),
    rowHeaderWidth: 46,
    colHeaderHeight: 24,
    cellWidth: 100,
    cellHeight: 21,
    visibleCols: Math.floor((snapshot.viewport.w - 46) / 100),
    visibleRows: Math.floor((snapshot.viewport.h - Math.max(174, Math.round(snapshot.viewport.h * 0.19) + 24)) / 21),
  };
}

async function trySelectGoogleSheetsNameBox(target: Debuggee, cell: string): Promise<boolean> {
  await typeIntoGoogleSheetsNameBox(target, undefined, cell);
  await key(target, 'Enter');
  return true;
}

async function trySelectSheetsRange(target: Debuggee, snapshot: A11ySnapshot, range: string): Promise<boolean> {
  // Click name box area
  const x = Math.max(55, Math.round(snapshot.viewport.w * 0.055));
  const y = Math.max(115, Math.round(snapshot.viewport.h * 0.145));
  await send(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(80);

  // Select all in name box, type range
  await selectAll(target);
  await sleep(40);
  await dispatchText(target, range);
  await sleep(60);
  await key(target, 'Enter');
  await sleep(300);

  // Verify: copy to check if range selected
  try {
    await shortcut(target, 'C', 4);
    await sleep(200);
    const clip = await readClipboardInPage(target, snapshot.url);
    return clip.length > 0;
  } catch {
    return false;
  }
}

async function typeIntoGoogleSheetsNameBox(target: Debuggee, snapshot: A11ySnapshot | undefined, text: string): Promise<void> {
  // Try via page JS first (finds input by ID/heuristic, sets value)
  const injected = await send<{ result?: { value?: boolean } }>(target, 'Runtime.evaluate', {
    expression: `
      (() => {
        const candidates = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
        const score = (el) => {
          const sig = [
            el.id || '',
            typeof el.className === 'string' ? el.className : '',
            el.getAttribute('aria-label') || '',
            el.getAttribute('title') || '',
            el.getAttribute('placeholder') || '',
            el.getAttribute('name') || ''
          ].join(' ').toLowerCase();
          if (el.id === 't-name-box') return 100;
          if (sig.includes('name box') || sig.includes('namebox')) return 90;
          if (sig.includes('cell reference') || sig.includes('ячейк')) return 70;
          if (sig.includes('range')) return 40;
          return 0;
        };
        const target = candidates
          .map((el) => ({ el, score: score(el) }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)[0]?.el;
        if (!target) return false;
        target.focus();
        if ('value' in target) {
          target.value = ${JSON.stringify(text)};
          target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(text)} }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          document.execCommand('selectAll', false);
          document.execCommand('insertText', false, ${JSON.stringify(text)});
        }
        return true;
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  }).catch(() => undefined);

  if (injected?.result?.value) return;

  // Fallback: click name box area and type via CDP
  if (snapshot) {
    const x = Math.max(55, Math.round(snapshot.viewport.w * 0.055));
    const y = Math.max(115, Math.round(snapshot.viewport.h * 0.145));
    await send(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(80);
    await selectAll(target);
    await dispatchText(target, text);
  }
}

async function clickGoogleSheetsNameBox(target: Debuggee, snapshot: A11ySnapshot): Promise<void> {
  const x = Math.max(55, Math.round(snapshot.viewport.w * 0.055));
  const y = Math.max(115, Math.round(snapshot.viewport.h * 0.145));
  await send(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(80);
}

function isGoogleSheet(url: string): boolean {
  return /^https:\/\/docs\.google\.com\/spreadsheets\//.test(url);
}

function clipboardLooksLikeTable(actual: string, expected: string): boolean {
  const actualNorm = normalizeTableText(actual);
  const expectedNorm = normalizeTableText(expected);
  if (!actualNorm || !expectedNorm) return false;
  if (actualNorm === expectedNorm) return true;

  const expectedRows = expectedNorm.split('\n');
  const actualRows = actualNorm.split('\n');
  if (actualRows.length < expectedRows.length) return false;
  return expectedRows.every((row, i) => actualRows[i] === row);
}

function parseTsv(tsv: string): string[][] {
  return tsv
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((row) => row.length > 0)
    .map((row) => row.split('\t').map((cell) => cell.trim()));
}

function parseCell(cell: string): { col: number; row: number } {
  const normalized = normalizeCellRef(cell);
  const match = normalized.match(/^([A-Z]+)(\d+)$/);
  if (!match) throw new Error(`Invalid startCell: ${cell}`);
  return { col: columnIndex(match[1]), row: Number(match[2]) };
}

function normalizeCellRef(cell: string): string {
  const normalized = cell.trim().toUpperCase();
  if (!/^[A-Z]+\d+$/.test(normalized)) throw new Error(`Invalid cell reference: ${cell}`);
  return normalized;
}

function columnIndex(name: string): number {
  let index = 0;
  for (const ch of name) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index;
}

function columnName(index: number): string {
  let name = '';
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function normalizeTableText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((row) => row.replace(/\t+$/g, '').trimEnd())
    .filter((row) => row.length > 0)
    .join('\n')
    .trim();
}

function normalizeCellText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function centerOf(snapshot: A11ySnapshot, ref: string): { x: number; y: number } {
  const node = snapshot.nodes.find((n) => n.ref === ref);
  if (!node) throw new Error(`Element ${ref} not found in snapshot`);
  return {
    x: Math.max(0, Math.round(node.bbox.x + node.bbox.w / 2)),
    y: Math.max(0, Math.round(node.bbox.y + node.bbox.h / 2)),
  };
}

async function selectAll(target: Debuggee): Promise<void> {
  await shortcut(target, 'A', 2);
  await shortcut(target, 'A', 4);
}

async function shortcut(target: Debuggee, keyName: string, modifiers: number): Promise<void> {
  await send(target, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: keyName.toLowerCase(),
    code: `Key${keyName}`,
    windowsVirtualKeyCode: keyName.toUpperCase().charCodeAt(0),
    nativeVirtualKeyCode: keyName.toUpperCase().charCodeAt(0),
    modifiers,
    ...(keyName.toUpperCase() === 'V' ? { commands: ['paste'] } : {}),
    ...(keyName.toUpperCase() === 'C' ? { commands: ['copy'] } : {}),
  });
  await send(target, 'Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: `Key${keyName}`, modifiers });
}

async function key(target: Debuggee, keyName: string, modifiers = 0): Promise<void> {
  await send(target, 'Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code: keyCode(keyName), modifiers });
  await send(target, 'Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: keyCode(keyName), modifiers });
}

function cdpModifiers(value: string): number {
  const parts = value.toLowerCase().split(/[\s,+]+/).filter(Boolean);
  let modifiers = 0;
  if (parts.includes('alt') || parts.includes('option')) modifiers += 1;
  if (parts.includes('ctrl') || parts.includes('control')) modifiers += 2;
  if (parts.includes('meta') || parts.includes('cmd') || parts.includes('command')) modifiers += 4;
  if (parts.includes('shift')) modifiers += 8;
  return modifiers;
}

function normalizeKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) throw new Error('press requires key');
  return trimmed.length === 1 ? trimmed.toLowerCase() : trimmed;
}

function keyCode(key: string): string {
  if (key.length === 1 && /[a-z]/i.test(key)) return `Key${key.toUpperCase()}`;
  return key;
}

// `sendCommand` is overloaded (promise and callback form), so its type is the
// intersection of both returns. The command params are keyed by name, and the
// result shape is per-method and known only to the caller — hence the cast.
function send<T = unknown>(target: Debuggee, method: string, params?: Record<string, unknown>): Promise<T> {
  return chrome.debugger.sendCommand(target, method, params) as unknown as Promise<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Applies stealth evasions to prevent automated browser detection (navigator.webdriver, plugins, permissions).
 */
export async function applyStealthPatches(target: Debuggee): Promise<void> {
  const stealthScript = `
    try {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });
      if (!navigator.plugins || navigator.plugins.length === 0) {
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          ],
          configurable: true,
        });
      }
      const origPerm = window.navigator.permissions?.query;
      if (origPerm) {
        window.navigator.permissions.query = (parameters) =>
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
            : origPerm(parameters);
      }
    } catch {}
  `;
  try {
    await send(target, 'Page.enable');
    await send(target, 'Page.addScriptToEvaluateOnNewDocument', { source: stealthScript });
    await send(target, 'Runtime.evaluate', { expression: stealthScript });
  } catch {}
}

/**
 * Dispatches a trusted CDP Press and Hold sequence with humanized micro-tremor.
 */
export async function cdpPressAndHold(target: Debuggee, x: number, y: number, durationMs = 6500): Promise<void> {
  await send(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send(target, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });

  const startTime = Date.now();
  while (Date.now() - startTime < durationMs) {
    await sleep(75);
    const jitterX = x + (Math.random() - 0.5) * 2;
    const jitterY = y + (Math.random() - 0.5) * 2;
    await send(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: jitterX,
      y: jitterY,
      button: 'left',
    }).catch(() => {});
  }

  await send(target, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
  await sleep(100);
}
