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

/**
 * Crops a high-resolution sub-region around a target bounding box with surrounding context padding.
 * Preserves 100% pixel sharpness for fine text, checkboxes, and dense UI elements.
 */
export async function cropBoundingBox(
  dataUrl: string,
  bbox: { x: number; y: number; w: number; h: number },
  viewport: { w: number; h: number },
  paddingPx = 100
): Promise<string> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);

    // Compute device pixel ratio / scale between viewport and captured bitmap
    const scaleX = bitmap.width / Math.max(1, viewport.w);
    const scaleY = bitmap.height / Math.max(1, viewport.h);

    const sourceX = Math.max(0, (bbox.x - paddingPx) * scaleX);
    const sourceY = Math.max(0, (bbox.y - paddingPx) * scaleY);
    const sourceW = Math.min(bitmap.width - sourceX, (bbox.w + paddingPx * 2) * scaleX);
    const sourceH = Math.min(bitmap.height - sourceY, (bbox.h + paddingPx * 2) * scaleY);

    if (sourceW <= 0 || sourceH <= 0) return dataUrl;

    const canvas = new OffscreenCanvas(Math.round(sourceW), Math.round(sourceH));
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;

    ctx.drawImage(bitmap, sourceX, sourceY, sourceW, sourceH, 0, 0, sourceW, sourceH);
    const out = await canvas.convertToBlob({ type: 'image/png' });
    return await blobToDataUrl(out);
  } catch (err) {
    console.warn('[SmartCrop] Failed to crop bounding box, using full screenshot:', err);
    return dataUrl;
  }
}

/**
 * Extracts a crisp, zoomed visual focus crop around a specific A11yNode.
 */
export async function smartCropTarget(
  dataUrl: string,
  bbox: { x: number; y: number; w: number; h: number },
  viewport: { w: number; h: number }
): Promise<string> {
  return cropBoundingBox(dataUrl, bbox, viewport, 120);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

