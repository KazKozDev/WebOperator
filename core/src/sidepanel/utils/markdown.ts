/**
 * Safe Markdown renderer for Side Panel UI.
 * Handles headers, code blocks, lists, links, and tables with strict sanitization.
 */

export function renderMarkdown(text: string): string {
  let html = escapeHtml(normalizeAnswerText(text));
  const codeBlocks: string[] = [];
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, _language: string, body: string) => {
    const token = `@@WEBOPERATOR_CODE_BLOCK_${codeBlocks.length}@@`;
    codeBlocks.push(`<pre><code>${body}</code></pre>`);
    return token;
  });
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<em><strong>$1</strong></em>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, rawHref: string) => renderSafeLink(label, rawHref));
  html = renderMarkdownTables(html);
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(
    /^\s*(\d+)\.\s+(.+)$/gm,
    '<li data-list="ol"><span class="answer-list-index">$1.</span><span class="answer-list-body">$2</span></li>',
  );
  html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li data-list="ol">.*<\/li>\n?)+)/g, '<ol>$1</ol>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  html = html.replace(/ data-list="ol"/g, '');
  html = html.replace(/>\n</g, '><');
  html = html.replace(/\n/g, '<br>');
  html = codeBlocks.reduce((rendered, block, index) => rendered.replace(`@@WEBOPERATOR_CODE_BLOCK_${index}@@`, block), html);
  return html;
}

export function renderMarkdownTables(markdown: string): string {
  const lines = markdown.split('\n');
  const rendered: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const headerLine = lines[index];
    const separatorLine = lines[index + 1];

    if (isMarkdownTableRow(headerLine) && separatorLine && isMarkdownTableSeparator(separatorLine)) {
      const headers = splitMarkdownTableRow(headerLine);
      const rows: string[][] = [];
      index += 2;

      while (index < lines.length && isMarkdownTableRow(lines[index]) && !isMarkdownTableSeparator(lines[index])) {
        rows.push(normalizeTableCells(splitMarkdownTableRow(lines[index]), headers.length));
        index += 1;
      }

      index -= 1;
      rendered.push(renderMarkdownTable(headers, rows));
      continue;
    }

    rendered.push(headerLine);
  }

  return rendered.join('\n');
}

export function renderMarkdownTable(headers: string[], rows: string[][]): string {
  const safeHeaders = normalizeTableCells(headers, headers.length);
  const headerHtml = safeHeaders.map((cell) => `<th>${cell}</th>`).join('');
  const bodyHtml = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('');

  return `<div class="answer-table-fit"><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

function normalizeTableCells(cells: string[], targetLength: number): string[] {
  return Array.from({ length: targetLength }, (_unused, index) => cells[index] ?? '');
}

function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes('|') && splitMarkdownTableRow(trimmed).length > 1;
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function renderSafeLink(label: string, rawHref: string): string {
  const href = normalizeSafeLinkHref(rawHref);
  if (!href) return label;
  return `<a href="${escapeHtmlAttribute(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

export function normalizeSafeLinkHref(rawHref: string): string | null {
  const href = rawHref.trim();
  if (!href) return null;

  try {
    const url = new URL(href);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
      return url.href;
    }
  } catch {
    return null;
  }

  return null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function normalizeAnswerText(text: string): string {
  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '  ')
    .replace(/\\"/g, '"');
}
