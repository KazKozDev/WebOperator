/**
 * Downloaded File Inspection and Content Extractor for WebOperator.
 * Inspects Chrome downloads and extracts text, CSV, JSON, and PDF metadata/content for the agent.
 */

export interface DownloadedFileInfo {
  id: number;
  filename: string;
  url: string;
  mime: string;
  fileSize: number;
  state: string;
  startTime: string;
  danger: string;
}

export interface ReadFileResult {
  ok: boolean;
  filename?: string;
  mime?: string;
  fileSize?: number;
  content?: string;
  error?: string;
}

/**
 * Lists the most recent downloads.
 */
export async function listRecentDownloads(limit = 5): Promise<DownloadedFileInfo[]> {
  if (typeof chrome === 'undefined' || !chrome.downloads) {
    return [];
  }

  try {
    const items = await chrome.downloads.search({
      limit,
      orderBy: ['-startTime'],
    });

    return items.map((item) => ({
      id: item.id,
      filename: item.filename,
      url: item.url,
      mime: item.mime,
      fileSize: item.fileSize,
      state: item.state,
      startTime: item.startTime,
      danger: item.danger,
    }));
  } catch (err) {
    console.warn('[FileReader] Could not list downloads:', err);
    return [];
  }
}

/**
 * Reads and parses the text/data of a downloaded file or recent download.
 */
export async function readLatestDownload(query?: string, maxCharacters = 8000): Promise<ReadFileResult> {
  if (typeof chrome === 'undefined' || !chrome.downloads) {
    return { ok: false, error: 'chrome.downloads API is not available' };
  }

  try {
    const items = await chrome.downloads.search({
      limit: 10,
      orderBy: ['-startTime'],
      state: 'complete',
      ...(query ? { query: [query] } : {}),
    });

    if (items.length === 0) {
      return { ok: false, error: 'No completed downloads found.' };
    }

    const target = items[0];
    const baseName = target.filename.split(/[/\\]/).pop() ?? target.filename;

    // For plain text, json, csv, tsv, html, xml, md
    const ext = baseName.split('.').pop()?.toLowerCase() ?? '';
    const isTextFormat = ['csv', 'tsv', 'json', 'txt', 'md', 'html', 'xml', 'log'].includes(ext);

    let parsedContent = '';

    if (isTextFormat && target.url.startsWith('data:')) {
      const dataPart = target.url.slice(target.url.indexOf(',') + 1);
      const decoded = decodeURIComponent(dataPart);
      parsedContent = decoded.slice(0, maxCharacters);
    } else if (isTextFormat && target.url.startsWith('blob:')) {

      try {
        const res = await fetch(target.url);
        const text = await res.text();
        parsedContent = text.slice(0, maxCharacters);
      } catch {
        parsedContent = `File: ${baseName} (${target.fileSize} bytes). Full path: ${target.filename}`;
      }
    } else {
      parsedContent = `Downloaded file: ${baseName} | Size: ${target.fileSize} bytes | MIME: ${target.mime} | State: ${target.state} | Path: ${target.filename}`;
    }

    return {
      ok: true,
      filename: baseName,
      mime: target.mime,
      fileSize: target.fileSize,
      content: parsedContent,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
