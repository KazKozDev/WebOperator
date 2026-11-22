import { findElementByRef } from '@/lib/a11y';

/** An image read from the page: its bytes as base64, what it is, and where it came from. */
export interface PageImage {
  src: string;
  mimeType: string;
  base64: string;
  width: number;
  height: number;
  bytes: number;
}

export type ImageReadResult =
  | { ok: true; image: PageImage }
  /** The page could not fetch it (CORS): the background worker can, from `src`. */
  | { ok: false; src: string; width: number; height: number; error: string }
  | { ok: false; error: string };

const MAX_BYTES = 40 * 1024 * 1024;

/**
 * The image a ref points at: the element itself when it is an <img>, otherwise the largest <img> inside it
 * (a dialog, a figure, a button that wraps a picture). Read-only: nothing on the page is clicked or changed.
 */
export function imageForRef(ref: string, root: ParentNode = document): HTMLImageElement | null {
  const el = root === document ? findElementByRef(ref) : root.querySelector<HTMLElement>(`[data-agent-ref="${CSS.escape(ref)}"]`);
  if (!el) return null;
  if (el instanceof HTMLImageElement) return el;
  const images = [...el.querySelectorAll('img')].filter((img) => (img.currentSrc || img.src) && img.complete);
  const area = (img: HTMLImageElement) => (img.naturalWidth || img.width) * (img.naturalHeight || img.height);
  return images.sort((a, b) => area(b) - area(a))[0] ?? null;
}

/** Base64 of a blob, in chunks; FileReader is not there in the extension's service worker, so it is not used. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Fetches the image the ref points at with the page's own session, and returns its bytes. */
export async function readImage(ref: string): Promise<ImageReadResult> {
  const img = imageForRef(ref);
  if (!img) return { ok: false, error: `No image at ${ref}; try the parent link or a snapshot with includeImages:true` };
  const src = img.currentSrc || img.src;
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  try {
    const res = await fetch(src, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (blob.size > MAX_BYTES) return { ok: false, error: `Image is larger than ${MAX_BYTES / 1024 / 1024} MB` };
    return { ok: true, image: { src, mimeType: blob.type || 'image/png', base64: await blobToBase64(blob), width, height, bytes: blob.size } };
  } catch (err) {
    return { ok: false, src, width, height, error: err instanceof Error ? err.message : String(err) };
  }
}
