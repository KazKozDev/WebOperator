import overlayFile from '../content/overlay.js?url&no-inline';
import { acquireCdp } from './cdp-session';

type Point = { x: number; y: number };
type View = Point & { width: number; height: number };
const busy = new Set<number>();

async function installCursor(tabId: number) {
  const [frame] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] }, files: [overlayFile.replace(/^\//, '')], world: 'ISOLATED',
  });
  if (!frame?.documentId || !frame.result) throw new Error('Cursor overlay unavailable');
  return { documentId: frame.documentId, position: frame.result as View };
}

export async function showCursor(tabId: number): Promise<void> {
  const { documentId, position } = await installCursor(tabId);
  await paintCursor(tabId, documentId, position, false);
}

async function paintCursor(tabId: number, documentId: string, point: Point, pressed: boolean): Promise<void> {
  const [painted] = await chrome.scripting.executeScript({
    target: { tabId, documentIds: [documentId] }, args: [point, pressed],
    func: (next: Point, down: boolean): boolean => {
      const state = globalThis as unknown as Record<symbol, (p: Point, click: boolean) => boolean>;
      return state[Symbol.for('weboperator.cursorPaint')](next, down);
    },
  });
  if (!painted?.result) throw new Error('Cursor point rejected');
}

export async function moveCursor(x: number, y: number, tabId: number): Promise<void> {
  await smoothMove(x, y, tabId, 1);
}

export async function smoothMove(x: number, y: number, tabId: number, steps = 20, modifiers = 0): Promise<void> {
  await perform({ x, y }, tabId, steps, false, modifiers);
}

export async function clickAt(x: number, y: number, tabId: number): Promise<void> {
  await perform({ x, y }, tabId, 1, true);
}

export async function clickSelector(selector: string, tabId: number): Promise<void> {
  await perform(selector, tabId, 20, true);
}

// Injected into the pinned document. Returning null also covers clipping and occlusion.
function visiblePoint(selector: string, verify: boolean): Point | null {
  function find(root: Document | ShadowRoot): Element | null {
    const direct = root.querySelector(selector);
    if (direct) return direct;
    for (const host of root.querySelectorAll('*')) {
      if (host.shadowRoot) {
        const nested = find(host.shadowRoot);
        if (nested) return nested;
      }
    }
    return null;
  }
  const element = find(document);
  if (!element || element.matches(':disabled')) return null;
  const key = Symbol.for('weboperator.cursorTarget');
  const state = globalThis as unknown as Record<symbol, WeakRef<Element>>;
  if (verify && state[key]?.deref() !== element) return null;
  if (!verify) state[key] = new WeakRef(element);
  const rect = element.getBoundingClientRect();
  const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
  const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
  if (right <= left || bottom <= top) return null;
  const x = (left + right) / 2, y = (top + bottom) / 2;
  let hit = document.elementFromPoint(x, y);
  while (hit && !element.contains(hit) && hit.shadowRoot) {
    const nested = hit.shadowRoot.elementFromPoint(x, y);
    if (nested === hit) break;
    hit = nested;
  }
  return element.contains(hit) ? { x, y } : null;
}

async function perform(target: Point | string, tabId: number, steps: number, click: boolean, modifiers = 0): Promise<void> {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Invalid tab ID');
  if (!Number.isInteger(steps) || steps < 1 || steps > 120) throw new Error('Expected 1–120 steps');
  if (busy.has(tabId)) throw new Error('Cursor is busy in this tab');
  busy.add(tabId);
  let release: (() => Promise<void>) | undefined;
  try {
    const { documentId, position: start } = await installCursor(tabId);
    const locate = async (verify: boolean): Promise<Point> => {
      if (typeof target !== 'string') return target;
      const [hit] = await chrome.scripting.executeScript({
        target: { tabId, documentIds: [documentId] }, func: visiblePoint, args: [target, verify],
      });
      if (!hit?.result) throw new Error('Selector is missing, disabled, hidden or covered');
      return hit.result;
    };
    const end = await locate(false);
    if (!Number.isFinite(end.x) || !Number.isFinite(end.y) || end.x < 0 || end.y < 0 ||
        end.x >= start.width || end.y >= start.height) throw new Error('Point outside viewport');

    release = await acquireCdp(tabId);
    for (let i = 1; i <= steps; i++) {
      const point = i === steps ? end : {
        x: start.x + (end.x - start.x) * i / steps,
        y: start.y + (end.y - start.y) * i / steps,
      };
      await paintCursor(tabId, documentId, point, false);
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, modifiers });
      if (i < steps) await new Promise<void>((resolve) => setTimeout(resolve, 16));
    }
    if (click) {
      const check = await locate(true);
      if (check.x !== end.x || check.y !== end.y) throw new Error('Target moved during hover');
      await paintCursor(tabId, documentId, end, true);
      const params = { ...end, button: 'left', clickCount: 1 };
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { ...params, type: 'mousePressed', buttons: 1 });
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { ...params, type: 'mouseReleased', buttons: 0 });
    }
  } finally {
    try { await release?.(); } finally { busy.delete(tabId); }
  }
}
