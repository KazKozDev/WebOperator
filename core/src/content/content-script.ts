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
    case 'snapshot:take': {
      const snapshot = buildSnapshot({ includeOutsideViewport: msg.options?.allElements });
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
    default:
      return { kind: 'error', error: 'Unknown message' };
  }
}

const OVERLAY_ID = '__gemma4_agent_overlay__';

function showOverlay(refs: string[]): void {
  hideOverlay();
  const host = document.createElement('div');
  host.id = OVERLAY_ID;
  Object.assign(host.style, {
    position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483647',
  } satisfies Partial<CSSStyleDeclaration>);
  for (const ref of refs) {
    const el = document.querySelector<HTMLElement>(`[data-agent-ref="${CSS.escape(ref)}"]`);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    const box = document.createElement('div');
    Object.assign(box.style, {
      position: 'absolute',
      left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
      outline: '2px solid #ff4c4c',
      background: 'rgba(255,76,76,0.08)',
    } satisfies Partial<CSSStyleDeclaration>);
    const label = document.createElement('span');
    label.textContent = ref;
    Object.assign(label.style, {
      position: 'absolute', top: '-18px', left: '0',
      background: '#ff4c4c', color: '#fff',
      font: '12px/1 ui-monospace, monospace', padding: '1px 4px', borderRadius: '2px',
    } satisfies Partial<CSSStyleDeclaration>);
    box.appendChild(label);
    host.appendChild(box);
  }
  document.documentElement.appendChild(host);
}

function hideOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}
