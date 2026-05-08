import { db } from './storage';
import { urlPattern } from './action-cache';
import type { A11ySnapshot, RecoveryMemory, SitePattern, ToolCall } from './types';

export async function getSitePattern(snapshot: A11ySnapshot): Promise<SitePattern | undefined> {
  const pat = urlPattern(snapshot.url);
  return db.sitePatterns.get(pat);
}

export async function learnFromSuccess(
  snapshot: A11ySnapshot,
  toolCalls: ToolCall[],
  _intent: string,
): Promise<void> {
  const pat = urlPattern(snapshot.url);
  const existing = await db.sitePatterns.get(pat);

  const now = Date.now();
  const sitePattern: SitePattern = {
    urlPattern: pat,
    notes: existing?.notes ?? '',
    updatedAt: now,
    hitCount: (existing?.hitCount ?? 0) + 1,
  };

  for (const call of toolCalls) {
    if (call.name === 'click' || call.name === 'type') {
      const ref = String(call.arguments.ref ?? '');
      const node = snapshot.nodes.find((n) => n.ref === ref);
      if (!node) continue;

      const lowerName = node.name.toLowerCase();

      if (isSearchInput(lowerName, node.role)) {
        sitePattern.searchInputRef = ref;
        sitePattern.searchSelector = `[data-agent-ref="${ref}"]`;
        sitePattern.notes += `\nsearch: ${ref} (${node.name})`;
      }

      if (isSearchButton(lowerName, node.role)) {
        sitePattern.searchButtonRef = ref;
        sitePattern.notes += `\nsearch-btn: ${ref} (${node.name})`;
      }

      if (isCookieAccept(lowerName)) {
        sitePattern.cookieAcceptSelector = `[data-agent-ref="${ref}"]`;
        sitePattern.notes += `\ncookie-accept: ${ref} (${node.name})`;
      }

      if (isLoginButton(lowerName, node.role)) {
        sitePattern.loginButtonSelector = `[data-agent-ref="${ref}"]`;
        sitePattern.notes += `\nlogin-btn: ${ref} (${node.name})`;
      }
    }
  }

  await db.sitePatterns.put(sitePattern);
}

export async function learnRecovery(
  snapshot: A11ySnapshot,
  failedAction: string,
  successAction: string,
  recoveryHint: string,
): Promise<void> {
  const pat = urlPattern(snapshot.url);
  const existing = await db.recoveryMemory.where({ urlPattern: pat, failedAction }).first();

  const record: RecoveryMemory = {
    urlPattern: pat,
    failedAction,
    successAction,
    recoveryHint,
    hitCount: (existing?.hitCount ?? 0) + 1,
  };

  await db.recoveryMemory.put(record);
}

export async function getRecoveryHint(
  snapshot: A11ySnapshot,
  failedAction: string,
): Promise<string | undefined> {
  const pat = urlPattern(snapshot.url);
  const record = await db.recoveryMemory.where({ urlPattern: pat, failedAction }).first();
  if (!record) return undefined;

  record.hitCount += 1;
  await db.recoveryMemory.put(record);
  return record.recoveryHint;
}

export async function getCookieHint(snapshot: A11ySnapshot): Promise<string | undefined> {
  const pattern = await getSitePattern(snapshot);
  if (pattern?.cookieAcceptSelector) {
    return `On this site cookies are dismissed by the selector ${pattern.cookieAcceptSelector}`;
  }
  return undefined;
}

export async function getSearchHint(snapshot: A11ySnapshot): Promise<string | undefined> {
  const pattern = await getSitePattern(snapshot);
  if (pattern?.searchInputRef) {
    return `Search input: ${pattern.searchInputRef}${pattern.searchButtonRef ? `, search button: ${pattern.searchButtonRef}` : ''}`;
  }
  return undefined;
}

export async function clearMemory(): Promise<number> {
  const s = await db.sitePatterns.count();
  const r = await db.recoveryMemory.count();
  await db.sitePatterns.clear();
  await db.recoveryMemory.clear();
  return s + r;
}

function isSearchInput(name: string, role: string): boolean {
  const s = name;
  return (role === 'textbox' || role === 'searchbox' || role === 'combobox') && (
    s.includes('search') || s.includes('поиск') || s.includes('q') || s.includes('query') ||
    s.includes('suche') || s.includes('recherche') || s.includes('buscar') || s.includes('searchbox')
  );
}

function isSearchButton(name: string, role: string): boolean {
  const s = name;
  return role === 'button' && (
    s.includes('search') || s.includes('поиск') || s.includes('найти') ||
    s.includes('go') || s.includes('find') || s.includes('suche')
  );
}

function isCookieAccept(name: string): boolean {
  const s = name;
  return s.includes('accept') || s.includes('cookie') || s.includes('согласен') ||
    s.includes('принять') || s.includes('agree') || s.includes('ok') ||
    s.includes('разрешить') || s.includes('allow') || s.includes('consent');
}

function isLoginButton(name: string, role: string): boolean {
  const s = name;
  return (role === 'button' || role === 'link') && (
    s.includes('login') || s.includes('log in') || s.includes('sign in') ||
    s.includes('войти') || s.includes('вход') || s.includes('signin')
  );
}
