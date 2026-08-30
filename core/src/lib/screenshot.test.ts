import { describe, expect, it } from 'vitest';
import { cropBoundingBox, smartCropTarget, stripDataUrlPrefix } from './screenshot';

describe('screenshot', () => {
  it('strips data url prefix correctly', () => {
    expect(stripDataUrlPrefix('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==')).toBe('iVBORw0KGgoAAAANSUhEUg==');
    expect(stripDataUrlPrefix('raw_base64_string')).toBe('raw_base64_string');
  });

  it('handles crop bounding box fallbacks safely in node environment', async () => {
    const raw = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const cropped = await cropBoundingBox(raw, { x: 10, y: 10, w: 50, h: 50 }, { w: 1920, h: 1080 });
    // In node/vitest without OffscreenCanvas DOM, it returns dataUrl safely without throwing
    expect(cropped).toBeDefined();
  });

  it('handles smartCropTarget safely', async () => {
    const raw = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const cropped = await smartCropTarget(raw, { x: 20, y: 30, w: 100, h: 40 }, { w: 1280, h: 720 });
    expect(cropped).toBeDefined();
  });
});
