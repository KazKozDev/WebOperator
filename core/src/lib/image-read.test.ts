import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findElementByRef } = vi.hoisted(() => ({ findElementByRef: vi.fn() }));
vi.mock('./a11y', () => ({ findElementByRef }));

class FakeImage {
  constructor(public currentSrc: string, public naturalWidth: number, public naturalHeight: number, public complete = true) {}
  get src() { return this.currentSrc; }
  get width() { return this.naturalWidth; }
  get height() { return this.naturalHeight; }
}

import { blobToBase64, imageForRef, readImage } from './image-read';

describe('reading an image by ref', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('HTMLImageElement', FakeImage);
    vi.stubGlobal('document', {});
  });

  it('takes the image itself, or the largest loaded image inside a container', () => {
    const big = new FakeImage('https://site/big.png', 1024, 1536);
    const thumb = new FakeImage('https://site/thumb.png', 64, 96);
    const loading = new FakeImage('https://site/loading.png', 4000, 4000, false);
    findElementByRef.mockReturnValueOnce(big);
    expect(imageForRef('@e1')).toBe(big);
    findElementByRef.mockReturnValueOnce({ querySelectorAll: () => [thumb, loading, big] });
    expect(imageForRef('@e2')).toBe(big);
    findElementByRef.mockReturnValueOnce(null);
    expect(imageForRef('@e3')).toBeNull();
  });

  it('returns the bytes the page fetched with its session', async () => {
    findElementByRef.mockReturnValue(new FakeImage('https://site/big.png', 1024, 1536));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['png-bytes'], { type: 'image/png' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await readImage('@e1');
    expect(fetchMock).toHaveBeenCalledWith('https://site/big.png', { credentials: 'include' });
    expect(result).toEqual({ ok: true, image: { src: 'https://site/big.png', mimeType: 'image/png', base64: btoa('png-bytes'), width: 1024, height: 1536, bytes: 9 } });
  });

  it('hands the address to the background worker when the page cannot fetch it', async () => {
    findElementByRef.mockReturnValue(new FakeImage('https://cdn/big.png', 1024, 1536));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await readImage('@e1')).toEqual({ ok: false, src: 'https://cdn/big.png', width: 1024, height: 1536, error: 'Failed to fetch' });
  });

  it('encodes large blobs in chunks', async () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
    const decoded = Uint8Array.from(atob(await blobToBase64(new Blob([bytes]))), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });
});
