import type { SkillId } from './types';

export type SkillRisk = 'safe' | 'medium' | 'high';

export interface SkillDefinition {
  id: SkillId;
  name: string;
  summary: string;
  risk: SkillRisk;
  domains: string[];
  keywords: string[];
  prompt: string;
}

export const BUILT_IN_SKILLS: SkillDefinition[] = [
  {
    id: 'form-filler',
    name: 'Form Filler',
    summary: 'Fill web forms and PDF forms — registration, checkout, documents',
    risk: 'safe',
    domains: ['*'],
    keywords: [
      'fill', 'form', 'register', 'signup', 'survey', 'application',
      'pdf', 'document', 'checkbox', 'radio', 'dropdown',
      'enter', 'input', 'fields',
    ],
    prompt: `[SKILL: form-filler]
You are filling out a form or PDF. Follow these rules:
1. Read all fields first. Match types: email → valid email, phone → valid phone, date → today.
2. Never fill password, credit card, or CAPTCHA fields — skip and report.
3. For selects/dropdowns: pick the most reasonable option or the first non-empty.
4. Check "I agree" checkboxes but note in report. Do NOT submit unless asked.
5. After filling, verify all required (*) fields are filled before reporting done.`,
  },
  {
    id: 'login-assistant',
    name: 'Login Assistant',
    summary: 'Handle sign-in flows — never invent credentials',
    risk: 'medium',
    domains: ['*'],
    keywords: [
      'login', 'log in', 'sign in', 'authenticate', 'credentials',
      'войти', 'логин', 'пароль', 'авторизация',
    ],
    prompt: `[SKILL: login-assistant]
You are handling a login flow. Follow these rules:
1. If already logged in, skip — continue the task.
2. Never type passwords yourself. If vault credentials are available, use fill_login_credentials.
3. If manual login is needed (password, CAPTCHA, 2FA), pause and ask the user.
4. Goal: logged in and back to the task. Verify: page shows logged-in state (account icon, no login form). Report "logged in" without revealing secrets.`,
  },
  {
    id: 'data-extractor',
    name: 'Data Extractor',
    summary: 'Extract structured data from pages',
    risk: 'safe',
    domains: ['*'],
    keywords: [
      'extract', 'scrape', 'collect', 'data', 'table', 'list', 'prices',
    ],
    prompt: `[SKILL: data-extractor]
You are extracting data from a page. Follow these rules:
1. Identify the structure: table, list, grid, cards.
2. Scroll to load all content before extracting.
3. Use extract tool to pull structured data. Navigate through pagination if present.
4. Format cleanly: numbers as numbers, dates consistently, no HTML tags.
5. Goal: structured data ready for the next step. Verify: all visible items captured, data types correct.`,
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets Operator',
    summary: 'Create and fill Google Sheets tables',
    risk: 'safe',
    domains: ['docs.google.com', 'sheets.google.com'],
    keywords: [
      'google sheets', 'sheets', 'spreadsheet', 'таблица',
    ],
    prompt: `[SKILL: google-sheets]
You are working in Google Sheets. Follow these rules:
1. New sheet: open https://sheets.new.
2. Fill data with fill_cells(tsv): TAB between columns, newline between rows. Include headers.
3. If fill_cells returns ok, the data is in separate cells. To verify, use read_cells("A1:C5") to read back values.
4. Use set_cell(cell, value) only for post-fill corrections.
5. Never paste CSV, markdown, or pipes — use TSV only (tabs + newlines).
6. Login wall? Report it, don't claim success.`,
  },
  {
    id: 'emailer',
    name: 'Email Manager',
    summary: 'Read, search, and compose emails',
    risk: 'medium',
    domains: ['mail.google.com', 'outlook.live.com', 'outlook.office.com'],
    keywords: ['email', 'inbox', 'gmail', 'compose', 'forward', 'reply'],
    prompt: `[SKILL: emailer]
You are working with email. Follow these rules:
1. Compose: fill To, Subject, Body. Wait for confirmation before Send.
2. Never send without explicit user confirmation — Send is a critical action.
3. Search with filters (from:, subject:) when looking for specific emails.
4. Never delete emails unless explicitly asked.
5. Goal: email composed with correct recipient, subject, body. Verify: all fields filled, no typos, user confirmed Send.`,
  },
  {
    id: 'researcher',
    name: 'Web Researcher',
    summary: 'Multi-step web research across sources',
    risk: 'safe',
    domains: ['*'],
    keywords: ['research', 'compare', 'analyze', 'review', 'find information'],
    prompt: `[SKILL: researcher]
You are researching a topic. Follow these rules:
1. Start with a search engine. Open results in new tabs with open_tab — keep search page open.
2. For each source: read, extract key data with extract tool. Note the URL.
3. Cross-reference specific facts (prices, dates, specs) across sources. If sources disagree, report the conflict and which source says what.
4. Verify: data from at least 2 independent sources, all fields the user asked for are filled, any contradictions are noted.`,
  },
  {
    id: 'shopping',
    name: 'Shopping Assistant',
    summary: 'Find products, compare prices, add to cart',
    risk: 'medium',
    domains: ['*'],
    keywords: ['buy', 'shop', 'cart', 'order', 'store', 'price', 'checkout'],
    prompt: `[SKILL: shopping]
You are shopping online. Follow these rules:
1. Search for the product, compare listings by price and rating.
2. Verify size/color/quantity before adding to cart.
3. NEVER complete payment — stop at checkout, report what's in cart.
4. Close discount popups before continuing.
5. Goal: products in cart with correct specs. Verify: cart shows correct items, quantities, prices.`,
  },
  {
    id: 'social-poster',
    name: 'Social Poster',
    summary: 'Post to Twitter/X, LinkedIn',
    risk: 'high',
    domains: ['x.com', 'twitter.com', 'linkedin.com'],
    keywords: ['tweet', 'post', 'publish', 'retweet', 'comment', 'reply', 'twitter', 'linkedin'],
    prompt: `[SKILL: social-poster]
You are posting on social media. Follow these rules:
1. NEVER post, tweet, reply, like, or follow without explicit confirmation for EACH action.
2. Check limits: Twitter 280 chars, LinkedIn 3000.
3. If a login/verification popup appears, pause and ask.
4. Goal: post/reply visible on the platform. Verify: content within limit, correct account, user confirmed.`,
  },
  {
    id: 'tab-manager',
    name: 'Tab Manager',
    summary: 'Open, switch, group, bookmark and close browser tabs',
    risk: 'safe',
    domains: ['*'],
    keywords: [
      'tab', 'tabs', 'new tab', 'open tab', 'switch tab', 'group tabs',
      'close tabs', 'bookmark', 'вкладка', 'вкладки',
    ],
    prompt: `[SKILL: tab-manager]
You are managing browser tabs. Follow these rules:
1. navigate(url) moves the current tab. open_tab(url) creates a new one — use when you need both pages.
2. Store tabIds with purpose: "sheet = 123, source = 124". Use switch_tab only with known IDs.
3. For research + sheets: keep sheet open → open sources in separate tabs → extract → switch back → fill.
4. Organizing: list_tabs first, group_tabs by topic, bookmark before closing.
5. close_tabs is destructive — confirm first.`,
  },
  {
    id: 'file-downloader',
    name: 'File Downloader',
    summary: 'Download files from pages',
    risk: 'medium',
    domains: ['*'],
    keywords: ['download', 'file', 'pdf', 'image', 'document', 'save', 'export'],
    prompt: `[SKILL: file-downloader]
You are downloading files. Follow these rules:
1. Identify download links, check file extensions.
2. Never download executables (.exe, .dmg, .sh) — warn and skip.
3. Click download, let the browser handle the save dialog.
4. Goal: all requested files queued. Verify: correct file types, sizes reported, no executables downloaded.`,
  },
];

export interface SkillMeta {
  abbr: string;
}

export const SKILL_META: Record<SkillId, SkillMeta> = {
  'form-filler':   { abbr: 'Form' },
  'login-assistant': { abbr: 'Login' },
  'data-extractor': { abbr: 'Extr' },
  'google-sheets': { abbr: 'Sheet' },
  'emailer':       { abbr: 'Mail' },
  'researcher':    { abbr: 'Rsrch' },
  'shopping':      { abbr: 'Cart' },
  'social-poster': { abbr: 'Post' },
  'tab-manager':   { abbr: 'Tabs' },
  'file-downloader': { abbr: 'DL' },
};

// ── Classifier ──
export interface ClassifiedSkill {
  id: SkillId;
  reason: string;
  auto: boolean;    // was auto-detected vs manually enabled
}

export function classifyTask(goal: string, _settings?: { autoSkills?: boolean }): ClassifiedSkill[] {
  const lower = goal.toLowerCase();
  const results: ClassifiedSkill[] = [];

  for (const skill of BUILT_IN_SKILLS) {
    // High-risk skills are NEVER auto-enabled
    if (skill.risk === 'high') continue;

    const matched = skill.keywords.filter((kw) => lower.includes(kw.toLowerCase()));
    if (matched.length > 0) {
      results.push({
        id: skill.id,
        reason: `matched: ${matched.slice(0, 2).join(', ')}`,
        auto: true,
      });
    }
  }

  return results;
}

export function getSkill(id: SkillId): SkillDefinition | undefined {
  return BUILT_IN_SKILLS.find((s) => s.id === id);
}

export function skillPrompts(ids: SkillId[]): string {
  const prompts: string[] = [];
  for (const id of ids) {
    const skill = getSkill(id);
    if (skill) {
      prompts.push(skill.prompt);
    }
  }
  return prompts.join('\n\n');
}

export function enabledSkillPrompts(ids: SkillId[]): string {
  return skillPrompts(ids);
}

export function isKnownSkill(id: string): id is SkillId {
  return BUILT_IN_SKILLS.some((skill) => skill.id === id);
}
