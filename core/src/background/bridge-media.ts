import { acquireCdp } from './cdp-session';
import { boundedNumber, evaluateInTab } from './bridge-browser';
import { readClipboardInPage, writeClipboardInPage } from './cdp-actions';

function modifierBits(value: unknown): number {
  const parts = String(value ?? '').toLowerCase().split(/[+ ,]+/);
  return (parts.some((p) => ['alt', 'option'].includes(p)) ? 1 : 0) | (parts.some((p) => ['ctrl', 'control'].includes(p)) ? 2 : 0) | (parts.some((p) => ['meta', 'cmd', 'command'].includes(p)) ? 4 : 0) | (parts.includes('shift') ? 8 : 0);
}

// This function is serialized into the chosen page main world by Runtime.evaluate.
function targetElement(ref: string): HTMLElement {
  const search = (root: Document | ShadowRoot): HTMLElement | null => {
    const found = root.querySelector<HTMLElement>(`[data-agent-ref="${CSS.escape(ref)}"]`);
    if (found) return found;
    for (const host of root.querySelectorAll('*')) if (host.shadowRoot) { const nested = search(host.shadowRoot); if (nested) return nested; }
    return null;
  };
  const el = search(document);
  if (!el) throw new Error(`Element ${ref} not found`);
  return el;
}

async function remoteElement(tabId: number, ref: string, frameId: number, fileInput = false): Promise<string> {
  if (!ref) throw new Error('Missing element ref');
  const expression = `(() => {const el=(${targetElement.toString()})(${JSON.stringify(ref)}); ${fileInput ? `if(el.matches('input[type="file"]')) return el; if(el.tagName==='LABEL' && el.control?.type==='file') return el.control; const child=el.querySelector('input[type="file"]') ?? el.parentElement?.querySelector('input[type="file"]'); if(!child) throw new Error('No file input at ref'); return child;` : `el.scrollIntoView({block:'center',inline:'center',behavior:'instant'}); if(!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) throw new Error('Element not visible after scroll'); return el;`} })()`;
  const result = await evaluateInTab(tabId, { expression, returnByValue: false, frameId });
  if (!result.ok || !('objectId' in result) || !result.objectId) throw new Error('exception' in result ? result.exception?.text ?? 'Evaluation failed' : 'error' in result ? result.error : 'Element not found');
  return result.objectId;
}

export async function mediaRequest(tabId: number, type: string, payload: Record<string, unknown>, frameId = 0) {
  const release = await acquireCdp(tabId);
  const target = { tabId };
  const objectIds: string[] = [];
  const send = <T = any>(method: string, params?: Record<string, unknown>) => chrome.debugger.sendCommand(target, method, params) as Promise<T>;
  const box = async (ref: string, targetFrameId = frameId) => {
    const objectId = await remoteElement(tabId, ref, targetFrameId);
    objectIds.push(objectId);
    const { model } = await send('DOM.getBoxModel', { objectId });
    const quad = model.border as number[];
    const xs = quad.filter((_, index) => index % 2 === 0), ys = quad.filter((_, index) => index % 2 === 1);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), scale: 1 };
  };
  try {
    if (type === 'clipboard.read' || type === 'clipboard.write') {
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      if (type === 'clipboard.read') return { text: await readClipboardInPage(target, tab.url ?? '') };
      if (typeof payload.text !== 'string') throw new Error('text must be a string');
      await writeClipboardInPage(target, tab.url ?? '', payload.text);
      return { ok: true };
    }
    if (type === 'browser.upload_file') {
      if (typeof payload.path !== 'string' || !payload.path.startsWith('/')) throw new Error('An absolute file path is required');
      const objectId = await remoteElement(tabId, String(payload.ref ?? ''), frameId, true);
      objectIds.push(objectId);
      await send('DOM.setFileInputFiles', { objectId, files: [payload.path] });
      return { ok: true, name: payload.fileName, size: payload.fileSize };
    }
    if (type === 'browser.screenshot') {
      if (payload.ref && payload.fullPage) throw new Error('Choose ref or fullPage, not both');
      const format = payload.format ?? 'png';
      if (!['png', 'jpeg'].includes(String(format))) throw new Error('format must be png or jpeg');
      const quality = boundedNumber(payload.quality, 80, 0, 100);
      let clip;
      if (payload.ref) clip = await box(String(payload.ref));
      const metrics = await send('Page.getLayoutMetrics');
      const viewport = metrics.cssLayoutViewport ?? metrics.layoutViewport;
      const content = metrics.cssContentSize ?? metrics.contentSize;
      if (clip) { clip.x += viewport.pageX; clip.y += viewport.pageY; }
      if (payload.fullPage) clip = { x: 0, y: 0, width: content.width, height: content.height, scale: 1 };
      const { data } = await send('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality } : {}), captureBeyondViewport: Boolean(clip), ...(clip ? { clip } : {}) });
      return { dataUrl: `data:image/${format};base64,${data}`, w: Math.round(clip?.width ?? viewport.clientWidth), h: Math.round(clip?.height ?? viewport.clientHeight) };
    }
    const modifiers = modifierBits(payload.modifiers);
    const move = async (point: { x: number; y: number }, extra: Record<string, unknown> = {}) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, modifiers, ...extra });
    const point = async (ref: string, targetFrameId = frameId) => {
      const rect = await box(ref, targetFrameId);
      // DOM box quads are expressed in the root viewport coordinate system, including child frames.
      if (!rect.width || !rect.height) throw new Error('Element not visible after scroll');
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    };
    if (type === 'browser.drag') {
      const fromRef = String(payload.from ?? ''), toRef = String(payload.to ?? '');
      const to = await point(toRef, typeof payload.toFrameId === 'number' ? payload.toFrameId : frameId);
      const from = await point(fromRef);
      const steps = boundedNumber(payload.steps, 12, 1, 100);
      await move(from);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1, modifiers });
      try { for (let i = 1; i <= steps; i++) { await move({ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }, { button: 'left', buttons: 1 }); await new Promise((resolve) => setTimeout(resolve, 16)); } }
      finally { await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'left', buttons: 0, clickCount: 1, modifiers }); }
      return { ok: true };
    }
    const pos = await point(String(payload.ref ?? ''));
    await move(pos);
    if (type === 'browser.hover') return { ok: true };
    const button = String(payload.button ?? 'left');
    if (!['left', 'right', 'middle'].includes(button)) throw new Error('button must be left, right or middle');
    const clickCount = boundedNumber(payload.clickCount, 1, 1, 3);
    for (let count = 1; count <= clickCount; count++) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...pos, button, clickCount: count, modifiers });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...pos, button, clickCount: count, modifiers });
    }
    return { ok: true };
  } finally {
    for (const objectId of objectIds) await send('Runtime.releaseObject', { objectId }).catch(() => {});
    await release();
  }
}
