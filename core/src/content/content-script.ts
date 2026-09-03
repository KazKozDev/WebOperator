import { buildSnapshot } from '@/lib/a11y';
import { runAction } from '@/lib/actions';
import { clearSetOfMark, renderSetOfMark } from '@/lib/som';
import type { CSMessage, CSResponse } from '@/lib/types';

declare global {
  interface Window {
    __gemma4AgentContentScriptLoaded?: boolean;
  }
}

if (!window.__gemma4AgentContentScriptLoaded) {
  window.__gemma4AgentContentScriptLoaded = true;
  chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
    const msg = raw as CSMessage;
    handle(msg).then(sendResponse).catch((err) => {
      sendResponse({ kind: 'error', error: err instanceof Error ? err.message : String(err) } satisfies CSResponse);
    });
    return true;
  });
}

async function handle(msg: CSMessage): Promise<CSResponse> {
  switch (msg.kind) {
    case 'ping': {
      return { kind: 'ok' };
    }
    case 'snapshot:take': {

      const snapshot = buildSnapshot({
        includeOutsideViewport: msg.options?.allElements,
        refPrefix: msg.options?.refPrefix,
        ...(msg.options?.maxNodes ? { maxNodes: msg.options.maxNodes } : {}),
      });
      return { kind: 'snapshot', snapshot };
    }
    case 'action:run': {
      const result = await runAction(msg.action, 10_000);
      return { kind: 'action:result', result };
    }
    case 'som:render': {
      renderSetOfMark(msg.snapshot);
      return { kind: 'ok' };
    }
    case 'som:clear': {
      clearSetOfMark();
      return { kind: 'ok' };
    }
    case 'overlay:show': {
      showOverlay(msg.refs);
      return { kind: 'ok' };
    }
    case 'overlay:hide': {
      hideOverlay();
      return { kind: 'ok' };
    }
    case 'agent-glow:set': {
      setAgentGlow(msg.active);
      return { kind: 'ok' };
    }
    default:
      return { kind: 'error', error: 'Unknown message' };
  }
}

const OVERLAY_ID = '__weboperator_agent_overlay__';
const AGENT_GLOW_ID = '__weboperator_agent_glow__';
const AGENT_GLOW_STYLE_ID = '__weboperator_agent_glow_style__';

function showOverlay(refs: string[]): void {
  hideOverlay();
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
    .overlay-box {
      position: absolute;
      outline: 2px solid #ff4c4c;
      background: rgba(255, 76, 76, 0.08);
      box-sizing: border-box;
      pointer-events: none;
    }
    .overlay-label {
      position: absolute;
      top: -18px;
      left: 0;
      background: #ff4c4c;
      color: #ffffff;
      font: 12px/1 ui-monospace, monospace;
      padding: 1px 4px;
      border-radius: 2px;
      white-space: nowrap;
      pointer-events: none;
    }
  `;
  shadow.appendChild(style);

  for (const ref of refs) {
    const el = document.querySelector<HTMLElement>(`[data-agent-ref="${CSS.escape(ref)}"]`);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = 'overlay-box';
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    const label = document.createElement('span');
    label.className = 'overlay-label';
    label.textContent = ref;

    box.appendChild(label);
    shadow.appendChild(box);
  }
  document.documentElement.appendChild(host);
}

function hideOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
  document.getElementById('__gemma4_agent_overlay__')?.remove();
}


function setAgentGlow(active: boolean): void {
  if (!active) {
    document.getElementById(AGENT_GLOW_ID)?.remove();
    return;
  }

  ensureAgentGlowStyle();
  if (document.getElementById(AGENT_GLOW_ID)) return;

  const glow = document.createElement('div');
  glow.id = AGENT_GLOW_ID;
  glow.setAttribute('aria-hidden', 'true');
  document.documentElement.appendChild(glow);
}

function ensureAgentGlowStyle(): void {
  if (document.getElementById(AGENT_GLOW_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = AGENT_GLOW_STYLE_ID;
  style.textContent = `
    #${AGENT_GLOW_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      pointer-events: none;
      /*
       * Neither a border nor a flat ramp reads as light: both keep a visible edge to the
       * band. What the eye reads as a glow is a fast, non-linear falloff — bright at the
       * frame, most of it gone within ~40px, trailing off to nothing by ~96px — so the
       * edge is where the light is brightest rather than where a line is drawn.
       */
      background:
        linear-gradient(to bottom, rgba(255, 206, 120, 0.34) 0, rgba(233, 176, 80, 0.13) 14px, rgba(212, 162, 78, 0.05) 42px, rgba(212, 162, 78, 0) 96px),
        linear-gradient(to top, rgba(255, 206, 120, 0.34) 0, rgba(233, 176, 80, 0.13) 14px, rgba(212, 162, 78, 0.05) 42px, rgba(212, 162, 78, 0) 96px),
        linear-gradient(to right, rgba(255, 206, 120, 0.34) 0, rgba(233, 176, 80, 0.13) 14px, rgba(212, 162, 78, 0.05) 42px, rgba(212, 162, 78, 0) 96px),
        linear-gradient(to left, rgba(255, 206, 120, 0.34) 0, rgba(233, 176, 80, 0.13) 14px, rgba(212, 162, 78, 0.05) 42px, rgba(212, 162, 78, 0) 96px);
      /* Opacity pulses instead of the shadows: it is composited, so it stays smooth on a busy page. */
      animation: weboperator-agent-edge-pulse 3s ease-in-out infinite;
      will-change: opacity;
    }

    @keyframes weboperator-agent-edge-pulse {
      0%, 100% { opacity: 0.55; }
      50% { opacity: 1; }
    }

    @media (prefers-reduced-motion: reduce) {
      #${AGENT_GLOW_ID} {
        animation: none;
        opacity: 0.8;
      }
    }
  `;
  document.documentElement.appendChild(style);
}


