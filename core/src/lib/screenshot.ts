const MIN_CAPTURE_INTERVAL_MS = 1100;
let lastCaptureAt = 0;

export async function captureViewport(windowId: number | undefined, maxDim = 1024): Promise<string> {
  const elapsed = Date.now() - lastCaptureAt;
  if (elapsed < MIN_CAPTURE_INTERVAL_MS) {
    await sleep(MIN_CAPTURE_INTERVAL_MS - elapsed);
  }
  const raw = await chrome.tabs.captureVisibleTab(windowId!, { format: 'png' });
  lastCaptureAt = Date.now();
  return downsample(raw, maxDim);
}

async function downsample(dataUrl: string, maxDim: number): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const out = await canvas.convertToBlob({ type: 'image/png' });
  return await blobToDataUrl(out);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
