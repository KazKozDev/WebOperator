/* global innerWidth, innerHeight, document */
// Loaded by the content script and on demand by the service worker in the same isolated world.
(() => {
  const key = Symbol.for('weboperator.virtualCursor');
  if (!globalThis[key]) {
    let host;
    let ring;
    let x;
    let y;
    globalThis[key] = () => ({
      x: x ?? Math.floor(innerWidth / 2), y: y ?? Math.floor(innerHeight / 2),
      width: innerWidth, height: innerHeight,
    });
    globalThis[Symbol.for('weboperator.cursorPaint')] = (point, pressed = false) => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) ||
          point.x < 0 || point.x >= innerWidth || point.y < 0 || point.y >= innerHeight) return false;
      if (!host) {
        host = document.createElement('span');
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'all:initial!important;display:block!important;position:fixed!important;inset:0 auto auto 0!important;width:28px!important;height:32px!important;pointer-events:none!important;z-index:2147483647!important;';
        const root = host.attachShadow({ mode: 'closed' });
        const ns = 'http://www.w3.org/2000/svg';
        const arrow = document.createElementNS(ns, 'svg');
        arrow.setAttribute('width', '32');
        arrow.setAttribute('height', '37');
        arrow.setAttribute('viewBox', '0 0 28 32');
        arrow.style.cssText = 'display:block;pointer-events:none;filter:drop-shadow(0 2px 2px #0009)';
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', 'M2 2 L24 17 L14 18 L19 28 L14 30 L9 20 L3 26 Z');
        path.setAttribute('fill', '#793cff');
        path.setAttribute('stroke', 'white');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-linejoin', 'round');
        arrow.append(path);
        ring = document.createElement('i');
        ring.style.cssText = 'position:absolute;left:-15px;top:-15px;width:30px;height:30px;border-radius:50%;border:3px solid #975cff;opacity:0;pointer-events:none';
        root.append(ring, arrow);
        host.id = '__weboperator_cursor__';
      }
      x = point.x;
      y = point.y;
      host.style.setProperty('transform', `translate(${x - 2}px,${y - 2}px)`, 'important');
      const parent = document.querySelector('dialog:modal') ?? document.fullscreenElement ?? document.documentElement;
      if (host.parentNode !== parent) parent.append(host);
      if (pressed) ring.animate([{ opacity: 1, transform: 'scale(.35)' }, { opacity: 0, transform: 'scale(1.4)' }], 380);
      return true;
    };
  }
  return globalThis[key]();
})();
