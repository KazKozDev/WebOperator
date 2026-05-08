import type { A11yNode, A11ySnapshot } from './types';

export interface SoMRenderOptions {
  maxMarks?: number;
  onlyClickable?: boolean;
}

const OVERLAY_ID = '__gemma4_som_overlay__';

export function renderSetOfMark(snapshot: A11ySnapshot, opts: SoMRenderOptions = {}): void {
  clearSetOfMark();
  const { maxMarks = 80, onlyClickable = true } = opts;
  const nodes = snapshot.nodes.filter((n) => n.inViewport && (!onlyClickable || isClickable(n))).slice(0, maxMarks);

  const host = document.createElement('div');
  host.id = OVERLAY_ID;
  Object.assign(host.style, {
    position: 'fixed', inset: '0', pointerEvents: 'none',
    zIndex: '2147483647',
  } satisfies Partial<CSSStyleDeclaration>);

  for (const n of nodes) {
    const idx = n.ref.replace(/^@e/, '');
    const box = document.createElement('div');
    Object.assign(box.style, {
      position: 'absolute',
      left: `${n.bbox.x}px`, top: `${n.bbox.y}px`,
      width: `${n.bbox.w}px`, height: `${n.bbox.h}px`,
      outline: '2px solid rgba(255, 80, 80, 0.9)',
      borderRadius: '2px',
      background: 'rgba(255, 80, 80, 0.04)',
    } satisfies Partial<CSSStyleDeclaration>);
    const label = document.createElement('span');
    label.textContent = idx;
    Object.assign(label.style, {
      position: 'absolute',
      top: '-10px', left: '-4px',
      background: '#ff2a2a', color: '#fff',
      font: 'bold 11px/1 ui-monospace, monospace',
      padding: '1px 4px', borderRadius: '8px',
      boxShadow: '0 0 0 1px #fff',
    } satisfies Partial<CSSStyleDeclaration>);
    box.appendChild(label);
    host.appendChild(box);
  }

  document.documentElement.appendChild(host);
}

export function clearSetOfMark(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

function isClickable(n: A11yNode): boolean {
  return [
    'button', 'link', 'textbox', 'searchbox', 'combobox',
    'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option',
  ].includes(n.role);
}
