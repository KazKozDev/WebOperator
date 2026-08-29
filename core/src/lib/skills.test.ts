import { describe, expect, it } from 'vitest';
import { BUILT_IN_SKILLS, classifyTask, enabledSkillPrompts, getSkill, isKnownSkill } from './skills';

describe('skills', () => {
  it('defines valid built-in skills with required fields', () => {
    expect(BUILT_IN_SKILLS.length).toBeGreaterThanOrEqual(10);
    for (const skill of BUILT_IN_SKILLS) {
      expect(skill.id).toBeDefined();
      expect(skill.name).toBeDefined();
      expect(skill.prompt).toContain(`[SKILL: ${skill.id}]`);
      expect(skill.keywords.length).toBeGreaterThan(0);
    }
  });

  it('classifies tasks automatically using English keywords', () => {
    const sheetResults = classifyTask('create a spreadsheet and fill data in google sheets');
    expect(sheetResults.some((s) => s.id === 'google-sheets')).toBe(true);

    const extractResults = classifyTask('extract all product prices and list them');
    expect(extractResults.some((s) => s.id === 'data-extractor')).toBe(true);
  });

  it('classifies tasks automatically using Russian keywords', () => {
    const sheetResults = classifyTask('найди цены на ноутбуки и собери в гугл таблицы');
    expect(sheetResults.some((s) => s.id === 'google-sheets')).toBe(true);
    expect(sheetResults.some((s) => s.id === 'data-extractor')).toBe(true);

    const formResults = classifyTask('заполни анкету на сайте');
    expect(formResults.some((s) => s.id === 'form-filler')).toBe(true);

    const loginResults = classifyTask('войти в личный кабинет через пароль');
    expect(loginResults.some((s) => s.id === 'login-assistant')).toBe(true);
  });

  it('never auto-classifies high risk skills', () => {
    const socialResults = classifyTask('publish a tweet on twitter');
    expect(socialResults.some((s) => s.id === 'social-poster')).toBe(false);
  });

  it('generates combined prompts for enabled skills', () => {
    const prompts = enabledSkillPrompts(['google-sheets', 'data-extractor']);
    expect(prompts).toContain('[SKILL: google-sheets]');
    expect(prompts).toContain('[SKILL: data-extractor]');
  });

  it('validates known skill IDs correctly', () => {
    expect(isKnownSkill('google-sheets')).toBe(true);
    expect(isKnownSkill('unknown-skill')).toBe(false);
    expect(getSkill('google-sheets')?.name).toBe('Google Sheets Operator');
  });

  it('supports asynchronous neural classification', async () => {
    const { classifyTaskNeural } = await import('./skills');
    const results = await classifyTaskNeural('заполни анкету');
    expect(results.some((s) => s.id === 'form-filler')).toBe(true);
  });
});

