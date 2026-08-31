import { describe, expect, it } from 'vitest';
import { classifyTask, MAX_AUTO_SKILLS } from './skills';

const ids = (goal: string) => classifyTask(goal).map((c) => c.id);

describe('skill routing', () => {
  it('never injects more than MAX_AUTO_SKILLS playbooks', () => {
    const goals = [
      'найди цены на ноутбуки и собери в гугл таблицы',
      'сравни цены на iphone 15 в трёх магазинах',
      'открой три вкладки и сравни информацию',
      'extract all product prices and list them',
      'скачай отчёт в pdf',
    ];
    for (const goal of goals) {
      expect(ids(goal).length).toBeLessThanOrEqual(MAX_AUTO_SKILLS);
    }
  });

  it('does not match a keyword in the middle of another word', () => {
    // "форма" used to match "ин-ФОРМА-цию", pulling form-filler into research goals.
    expect(ids('проверь информацию о дате релиза')).not.toContain('form-filler');
    expect(ids('погугли информацию о новых релизах и сравни источники')).not.toContain('form-filler');
    expect(ids('открой три вкладки и сравни информацию')).not.toContain('form-filler');
  });

  it('does not route documentation or downloads to the form filler', () => {
    // "документ" as a bare keyword fired on documentation and on report
    // downloads; filling a document is always phrased with a verb.
    expect(ids('найди в документации react как работает useEffect')).not.toContain('form-filler');
    expect(ids('download the annual report document')).not.toContain('form-filler');
    expect(ids('заполни pdf форму заявления')).toContain('form-filler');
  });

  it('still matches inflected forms of a keyword', () => {
    // The tail stays open: "поиск" → "поиска", "search" → "searching".
    expect(ids('заполни анкету на сайте')).toContain('form-filler');
    expect(ids('searching for benchmark results')).toContain('researcher');
  });

  it('ranks keyword hits above semantic matches', () => {
    const results = classifyTask('скачай отчёт в pdf');
    expect(results[0].id).toBe('file-downloader');
    expect(results[0].score).toBeGreaterThan(0.55);
  });

  it('ranks a multi-word hit above a single common verb', () => {
    const results = classifyTask('найди цены на ноутбуки и собери в гугл таблицы');
    expect(results[0].id).toBe('google-sheets');
    expect(results.map((r) => r.id)).not.toContain('researcher');
  });

  it('does not route documentation or downloads to the form filler', () => {
    // A bare "документ"/"document" keyword fired on documentation and on report
    // downloads alike; filling one is always phrased with a verb.
    expect(ids('найди в документации react как работает useEffect')).not.toContain('form-filler');
    expect(ids('download the annual report document')).not.toContain('form-filler');
    expect(ids('заполни pdf форму заявления')).toContain('form-filler');
  });

  it('routes site-scoped goals to site-search', () => {
    expect(ids('найди в документации react как работает useEffect')).toContain('site-search');
    expect(ids('find the pricing page on their website and list the tiers')).toContain('site-search');
    expect(ids('проверь наличие товара в каталоге магазина')).toContain('site-search');
  });

  it('does not let a short generic phrase outrank a specific skill', () => {
    // "на сайте" is said in half of all goals; it must not beat two direct hits.
    const results = classifyTask('заполни анкету на сайте');
    expect(results[0].id).toBe('form-filler');
  });

  it('routes claim verification to fact-checker instead of researcher', () => {
    for (const goal of [
      'правда ли что компания X закрыла офис в Берлине',
      'is it true that the CEO resigned last week',
    ]) {
      expect(ids(goal)).toContain('fact-checker');
      expect(ids(goal)).not.toContain('researcher');
    }
  });

  it('keeps the better-scoring skill of a conflicting pair', () => {
    const custom = [
      {
        id: 'fixture-checker',
        name: 'Fixture Checker',
        summary: 'Verify a single claim against its primary source',
        risk: 'safe' as const,
        domains: ['*'],
        keywords: ['правда ли', 'верификация факта'],
        conflictsWith: ['researcher'],
        prompt: '[SKILL: fixture-checker] Find the primary source.',
        isCustom: true,
        enabled: true,
        createdAt: Date.now(),
      },
    ];

    const results = classifyTask('правда ли что компания закрыла офис, найди источники', custom);
    expect(results.map((r) => r.id)).toContain('fixture-checker');
    expect(results.map((r) => r.id)).not.toContain('researcher');
  });
});
