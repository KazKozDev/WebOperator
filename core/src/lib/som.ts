import type { A11yNode, A11ySnapshot } from './types';

export interface SoMRenderOptions {
  maxMarks?: number;
  onlyClickable?: boolean;
}

const OVERLAY_ID = '__weboperator_som_overlay__';

export function renderSetOfMark(snapshot: A11ySnapshot, opts: SoMRenderOptions = {}): void {
  clearSetOfMark();
  const { maxMarks = 80, onlyClickable = true } = opts;
  const nodes = snapshot.nodes.filter((n) => n.inViewport && (!onlyClickable || isClickable(n))).slice(0, maxMarks);

  const host = document.createElement('div');
  host.id = OVERLAY_ID;
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '2147483647',
    all: 'initial',
  } satisfies Partial<CSSStyleDeclaration>);

  // Isolated Closed Shadow Root
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483647;
    }
    .som-container {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .som-box {
      position: absolute;
      outline: 2px solid rgba(255, 80, 80, 0.9);
      border-radius: 2px;
      background: rgba(255, 80, 80, 0.04);
      box-sizing: border-box;
      pointer-events: none;
    }
    .som-label {
      position: absolute;
      top: -10px;
      left: -4px;
      background: #ff2a2a;
      color: #ffffff;
      font: bold 11px/1 ui-monospace, monospace;
      padding: 1px 4px;
      border-radius: 8px;
      box-shadow: 0 0 0 1px #ffffff;
      white-space: nowrap;
      pointer-events: none;
    }
  `;
  shadow.appendChild(style);

  const container = document.createElement('div');
  container.className = 'som-container';

  for (const n of nodes) {
    const idx = n.ref.replace(/^@e/, '');
    const box = document.createElement('div');
    box.className = 'som-box';
    box.style.left = `${n.bbox.x}px`;
    box.style.top = `${n.bbox.y}px`;
    box.style.width = `${n.bbox.w}px`;
    box.style.height = `${n.bbox.h}px`;

    const label = document.createElement('span');
    label.className = 'som-label';
    label.textContent = idx;

    box.appendChild(label);
    container.appendChild(box);
  }

  shadow.appendChild(container);
  document.documentElement.appendChild(host);
}

export function clearSetOfMark(): void {
  document.getElementById(OVERLAY_ID)?.remove();
  // Clean up legacy id if present
  document.getElementById('__gemma4_som_overlay__')?.remove();
}

function isClickable(n: A11yNode): boolean {
  return [
    'button', 'link', 'textbox', 'searchbox', 'combobox',
    'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option',
  ].includes(n.role);
}

