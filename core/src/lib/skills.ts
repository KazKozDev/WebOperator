import type { CustomSkillDefinition, SkillId } from './types';


export type SkillRisk = 'safe' | 'medium' | 'high';

export interface SkillDefinition {
  id: SkillId;
  name: string;
  summary: string;
  risk: SkillRisk;
  domains: string[];
  keywords: string[];
  /** Skills that solve the same intent differently; only the better-scoring one survives. */
  conflictsWith?: SkillId[];
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
      'заполни', 'заполнить', 'форма', 'форму', 'регистрация', 'анкета',
      'документ', 'поле', 'введи',
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
      'войти', 'логин', 'пароль', 'авторизация', 'авторизуйся', 'вход',
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
      'извлеки', 'извлечь', 'собери', 'собрать', 'спарси', 'парсинг', 'данные',
      'список', 'цены', 'таблица', 'выгрузи',
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
      'google sheets', 'sheets', 'spreadsheet', 'таблица', 'таблицу', 'гугл таблицы',
      'таблицы', 'эксель', 'excel',
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
    keywords: [
      'email', 'inbox', 'gmail', 'compose', 'forward', 'reply',
      'почта', 'письмо', 'напиши письмо', 'мейл', 'ответь на почту',
    ],
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
    keywords: [
      'research', 'compare', 'analyze', 'review', 'find information',
      'search', 'google', 'look up', 'find out', 'investigate', 'search for',
      'web search', 'gather information', 'explore sources',
      'исследуй', 'исследование', 'сравни', 'сравнить', 'проанализируй',
      'найди информацию', 'поищи информацию', 'погугли', 'найди', 'поиск',
      'поищи', 'узнай', 'найди в интернете', 'погугли информацию',
      'проверь информацию', 'найди статью', 'поищи в сети',
    ],
    prompt: `[SKILL: researcher]
You are conducting web research across multiple sources. Follow this disciplined strategy:
1. Query Formulation: Convert conversational user goals into concise, high-signal search keywords (omit filler phrases like "can you find"). Navigate to a search engine (Google/DuckDuckGo/Bing) if not already on one.
2. SERP Navigation & Filtering: Ignore sponsored ads / promoted links. Evaluate snippet credibility and recency before opening.
3. Hub-and-Spoke Tab Strategy: Keep the search engine results tab open as your hub. Open promising candidate links in new tabs using open_tab(url). Switch to each tab with switch_tab(tabId), extract findings, and close unneeded tabs with close_tabs to keep context focused.
4. Information Extraction & Cross-Checking: Use extract tool to capture exact numbers, facts, dates, specifications, and source URLs. Verify critical claims across at least 2 independent reputable sources. Explicitly note discrepancies or conflicts.
5. Query Reformulation on Dead Ends: If top results lack answers, are paywalled, or blocked, reformulate the query with specific terminology, quotes, or site: operators.
6. Evidence-Based Reporting: Final done summary must synthesize the findings clearly with attributed source URLs, direct answers to all requested points, and zero truncation.`,
  },
  {
    id: 'shopping',
    name: 'Shopping Assistant',
    summary: 'Find products, compare prices, add to cart',
    risk: 'medium',
    domains: ['*'],
    keywords: [
      'buy', 'shop', 'cart', 'order', 'store', 'price', 'checkout',
      'купи', 'купить', 'корзина', 'в корзину', 'магазин', 'цена', 'заказ', 'заказать',
    ],
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
    keywords: [
      'tweet', 'post', 'publish', 'retweet', 'comment', 'reply', 'twitter', 'linkedin',
      'твит', 'твиттер', 'пост', 'опубликуй', 'комментарий',
    ],
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
      'close tabs', 'bookmark', 'вкладка', 'вкладки', 'открой вкладку',
      'закрой вкладки', 'сгруппируй', 'закладка',
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
    keywords: [
      'download', 'file', 'pdf', 'image', 'document', 'save', 'export',
      'скачай', 'скачать', 'файл', 'загрузи', 'сохрани файл', 'экспорт',
    ],
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

import { SemanticRouter } from './semantic-router';

export interface ClassifiedSkill {
  id: SkillId;
  reason: string;
  auto: boolean;
  /** Routing confidence, 0..1. Keyword hits outrank semantic ones. */
  score: number;
}

/**
 * Upper bound on skills injected into one task prompt. Two playbooks still
 * compose; more start contradicting each other and crowd out the tool list.
 */
export const MAX_AUTO_SKILLS = 2;

/**
 * A keyword hits only when it starts at a word boundary, so "форма" no longer
 * matches "информацию" and "search" no longer matches "research". The tail is
 * left open on purpose: inflected forms ("поиска", "searching") must still hit.
 */
function keywordHits(goal: string, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}`, 'iu').test(goal);
}

function applyConflicts(
  ranked: ClassifiedSkill[],
  customSkills: CustomSkillDefinition[],
): ClassifiedSkill[] {
  const kept: ClassifiedSkill[] = [];
  for (const candidate of ranked) {
    const skill = getSkill(candidate.id, customSkills);
    const conflicts = skill?.conflictsWith ?? [];
    const loses = kept.some(
      (winner) =>
        conflicts.includes(winner.id) ||
        (getSkill(winner.id, customSkills)?.conflictsWith ?? []).includes(candidate.id),
    );
    if (!loses) kept.push(candidate);
  }
  return kept;
}

/** Highest confidence first, conflicts resolved, capped at MAX_AUTO_SKILLS. */
function rank(
  results: Map<SkillId, ClassifiedSkill>,
  customSkills: CustomSkillDefinition[],
): ClassifiedSkill[] {
  const ordered = Array.from(results.values()).sort((a, b) => b.score - a.score);
  return applyConflicts(ordered, customSkills).slice(0, MAX_AUTO_SKILLS);
}

export function classifyTask(goal: string, customSkills: CustomSkillDefinition[] = []): ClassifiedSkill[] {

  const results = new Map<SkillId, ClassifiedSkill>();
  const allSkills = [...BUILT_IN_SKILLS, ...customSkills.filter((cs) => cs.enabled !== false)];

  // 1. Stage 1: Fast keyword matches
  for (const skill of allSkills) {
    if (skill.risk === 'high') continue;

    const matched = skill.keywords.filter((kw) => keywordHits(goal, kw));
    if (matched.length > 0) {
      // More hits mean more evidence; a multi-word hit is far more specific
      // than a single common verb, so it counts for more.
      const specific = matched.some((kw) => kw.trim().includes(' '));
      const score = Math.min(0.99, 0.6 + 0.06 * matched.length + (specific ? 0.1 : 0));
      results.set(skill.id, {
        id: skill.id,
        reason: `matched: ${matched.slice(0, 2).join(', ')}`,
        auto: true,
        score,
      });
    }
  }

  // 2. Stage 2: Semantic vector router for synonyms, paraphrasing and semantic concepts
  const dynamicRouter = new SemanticRouter(
    allSkills.map((skill) => ({
      id: skill.id,
      // The prompt is deliberately left out: it is the longest part of a skill,
      // so indexing it makes routing drift every time a playbook is reworded.
      text: `${skill.name} ${skill.summary} ${skill.keywords.join(' ')}`,
    }))
  );

  const semanticMatches = dynamicRouter.query(goal, 0.22);
  for (const match of semanticMatches) {
    const skill = getSkill(match.id, customSkills);
    if (!skill || skill.risk === 'high') continue;
    if (!results.has(skill.id)) {
      results.set(skill.id, {
        id: skill.id,
        // Kept below every keyword hit: a vector match is the weaker signal.
        reason: `semantic vector match (${match.score})`,
        auto: true,
        score: Math.min(0.55, match.score),
      });
    }
  }

  return rank(results, customSkills);
}

export async function classifyTaskNeural(goal: string, customSkills: CustomSkillDefinition[] = []): Promise<ClassifiedSkill[]> {
  const syncResults = classifyTask(goal, customSkills);
  try {
    const { classifyWithHuggingFace } = await import('./hf-classifier');
    const hfResults = await classifyWithHuggingFace(goal);
    const map = new Map<SkillId, ClassifiedSkill>();
    for (const r of syncResults) map.set(r.id, r);
    for (const r of hfResults) {
      if (!map.has(r.id)) map.set(r.id, r);
    }
    return rank(map, customSkills);
  } catch {
    return syncResults;
  }
}

export function getSkill(id: SkillId, customSkills: CustomSkillDefinition[] = []): SkillDefinition | CustomSkillDefinition | undefined {
  const custom = customSkills.find((s) => s.id === id);
  if (custom) return custom;
  return BUILT_IN_SKILLS.find((s) => s.id === id);
}

export function skillPrompts(ids: SkillId[], customSkills: CustomSkillDefinition[] = []): string {
  const prompts: string[] = [];
  for (const id of ids) {
    const skill = getSkill(id, customSkills);
    if (skill) {
      prompts.push(skill.prompt);
    }
  }
  return prompts.join('\n\n');
}

export function enabledSkillPrompts(ids: SkillId[], customSkills: CustomSkillDefinition[] = []): string {
  return skillPrompts(ids, customSkills);
}

export function isKnownSkill(id: string, customSkills: CustomSkillDefinition[] = []): id is SkillId {
  return BUILT_IN_SKILLS.some((skill) => skill.id === id) || customSkills.some((skill) => skill.id === id);
}

