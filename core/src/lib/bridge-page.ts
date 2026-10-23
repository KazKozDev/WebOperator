import { findElementByRef, queryOpenRoots } from './a11y';

function scope(payload: Record<string, unknown>): HTMLElement {
  const node = payload.ref ? findElementByRef(String(payload.ref)) : payload.selector ? document.querySelector<HTMLElement>(String(payload.selector)) : document.body;
  if (!node) throw new Error('Page scope not found');
  return node;
}

function markdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof Element)) return '';
  if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(node.tagName)) return '';
  const content = [...node.childNodes].map(markdown).join('');
  if (/^H[1-6]$/.test(node.tagName)) return `\n\n${'#'.repeat(Number(node.tagName[1]))} ${content.trim()}\n\n`;
  if (node.tagName === 'A') return `[${content.trim()}](${(node as HTMLAnchorElement).href})`;
  if (node.tagName === 'IMG') return `![${(node as HTMLImageElement).alt}](${(node as HTMLImageElement).src})`;
  if (node.tagName === 'PRE') return `\n\n\`\`\`\n${node.textContent}\n\`\`\`\n\n`;
  if (node.tagName === 'CODE') return `\`${content}\``;
  if (['STRONG', 'B'].includes(node.tagName)) return `**${content}**`;
  if (['EM', 'I'].includes(node.tagName)) return `*${content}*`;
  if (node.tagName === 'LI') return `\n- ${content.trim()}`;
  if (node.tagName === 'BR') return '\n';
  if (['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'UL', 'OL', 'TR'].includes(node.tagName)) return `\n\n${content}\n\n`;
  if (['TH', 'TD'].includes(node.tagName)) return `${content.trim()} | `;
  return content;
}

export function pageRequest(type: string, payload: Record<string, unknown>): unknown {
  if (type === 'storage.get' || type === 'storage.set') {
    if (!['local', 'session'].includes(String(payload.kind))) throw new Error('kind must be local or session');
    const storage = payload.kind === 'local' ? window.localStorage : window.sessionStorage;
    if (type === 'storage.get') {
      if (payload.keys !== undefined && (!Array.isArray(payload.keys) || !payload.keys.every((key) => typeof key === 'string'))) throw new Error('keys must be strings');
      const keys = payload.keys as string[] | undefined ?? Array.from({ length: storage.length }, (_, index) => storage.key(index)!);
      return { items: Object.fromEntries(keys.map((key) => [key, storage.getItem(key)])) };
    }
    if (!payload.items || typeof payload.items !== 'object' || Array.isArray(payload.items) || !Object.values(payload.items).every((value) => typeof value === 'string')) throw new Error('items must be an object of strings');
    for (const [key, value] of Object.entries(payload.items)) storage.setItem(key, value as string);
    return { ok: true };
  }
  if (type === 'browser.read' || type === 'browser.extract_context') {
    const maxChars = Number(payload.maxChars ?? 40000);
    if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 200000) throw new Error('maxChars must be between 1 and 200000');
    const node = scope(payload);
    const format = payload.format ?? 'text';
    if (!['text', 'markdown'].includes(String(format))) throw new Error('format must be text or markdown');
    const full = format === 'markdown' ? markdown(node).replace(/\n{3,}/g, '\n\n').trim() : node.innerText;
    const content = full.slice(0, maxChars);
    return { content, chars: content.length, truncated: full.length > maxChars };
  }
  if (type === 'browser.target') {
    const node = scope(payload);
    node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height || !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) throw new Error('Element not visible after scroll');
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, clip: { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height, scale: 1 }, scrollX: window.scrollX, scrollY: window.scrollY, frameId: 0 };
  }
  if (type === 'browser.structured_source') {
    const nodes = payload.ref ? [scope(payload)] : payload.selector ? [...document.querySelectorAll<HTMLElement>(String(payload.selector))] : [document.body];
    // Keep attributes and field text alongside prose so structured extraction does not guess omitted values.
    return { items: nodes.slice(0, 500).map((node) => ({ text: node.innerText.slice(0, 2000), fields: queryOpenRoots<HTMLElement>('[data-field],[itemprop],input,a', node).slice(0, 50).map((field) => ({ field: field.getAttribute('data-field') ?? field.getAttribute('itemprop') ?? field.getAttribute('name'), text: field.innerText, value: (field as HTMLInputElement).type === 'password' ? undefined : (field as HTMLInputElement).value, href: (field as HTMLAnchorElement).href })) })) };
  }
  throw new Error(`Unknown page request: ${type}`);
}
