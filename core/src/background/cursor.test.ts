import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clickAt, clickSelector, moveCursor, smoothMove } from './cursor';
import { acquireCdp } from './cdp-session';

vi.mock('./cdp-session', () => ({ acquireCdp: vi.fn() }));

const release = vi.fn();
const send = vi.fn();
const paint = vi.fn(() => true);
const key = Symbol.for('weboperator.cursorPaint');
const targetKey = Symbol.for('weboperator.cursorTarget');
const rect = { left: 20, top: 10, right: 40, bottom: 30 };
function button() {
  return { matches: () => false, getBoundingClientRect: () => rect, contains: (hit: unknown) => hit === current };
}
let current = button();
const hit = vi.fn((): unknown => current);

describe('virtual cursor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    current = button();
    hit.mockImplementation(() => current);
    vi.mocked(acquireCdp).mockResolvedValue(release);
    send.mockResolvedValue(undefined);
    vi.stubGlobal(key, paint);
    vi.stubGlobal('innerWidth', 100);
    vi.stubGlobal('innerHeight', 100);
    vi.stubGlobal('document', { querySelector: () => current, elementFromPoint: hit });
    vi.stubGlobal('chrome', {
      debugger: { sendCommand: send },
      scripting: { executeScript: async (request: {
        files?: string[]; func?: (...args: never[]) => unknown; args: never[];
        target: { documentIds?: string[] };
      }) => {
        if (request.files) return [{ documentId: 'doc', result: { x: 0, y: 0, width: 100, height: 100 } }];
        expect(request.target.documentIds).toEqual(['doc']);
        return [{ result: request.func?.(...request.args) }];
      } },
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, targetKey);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('moves to the visible centre and clicks once after twenty moves', async () => {
    vi.useFakeTimers();
    const action = clickSelector('#show', 4);
    await vi.runAllTimersAsync();
    await action;
    expect(paint).toHaveBeenCalledTimes(21);
    expect(paint).toHaveBeenLastCalledWith({ x: 30, y: 20 }, true);
    expect(hit).toHaveBeenCalledTimes(2);
    const events = send.mock.calls.map(([, , event]) => event);
    expect(events.slice(0, 20).every(event => event.type === 'mouseMoved')).toBe(true);
    expect(events.slice(20)).toEqual([
      { x: 30, y: 20, type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1 },
      { x: 30, y: 20, type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1 },
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('aborts when hover replaces the element at identical coordinates', async () => {
    vi.useFakeTimers();
    send.mockImplementationOnce(async () => { current = button(); });
    const rejection = expect(clickSelector('#show', 4)).rejects.toThrow();
    await vi.runAllTimersAsync();
    await rejection;
    expect(send.mock.calls.every(([, , event]) => event.type === 'mouseMoved')).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rejects a covered target, invalid steps and out-of-bounds coordinates before attaching', async () => {
    hit.mockReturnValue(null);
    await expect(clickSelector('#show', 4)).rejects.toThrow();
    await expect(smoothMove(1, 1, 4, 0)).rejects.toThrow();
    await expect(clickAt(100, 50, 4)).rejects.toThrow();
    expect(acquireCdp).not.toHaveBeenCalled();
  });

  it('releases on dispatch failure and accepts the next move', async () => {
    send.mockRejectedValueOnce(new Error('Detached'));
    await expect(clickAt(1, 2, 4)).rejects.toThrow('Detached');
    await moveCursor(3, 4, 4);
    expect(paint).toHaveBeenLastCalledWith({ x: 3, y: 4 }, false);
    expect(release).toHaveBeenCalledTimes(2);
  });
});
