import { describe, expect, it } from 'vitest';
import { SemanticRouter } from './semantic-router';

describe('SemanticRouter', () => {
  const router = new SemanticRouter([
    {
      id: 'sheets',
      text: 'Google Sheets spreadsheets tables data grid cells fill_cells TSV эксель таблицы ячейки',
    },
    {
      id: 'forms',
      text: 'Web form registration survey inputs fields checkboxes заполни анкету регистрация',
    },
    {
      id: 'downloader',
      text: 'Download file PDF export image save document скачай файл выгрузка',
    },
  ]);

  it('matches exact and synonymous terms with high semantic score', () => {
    const matches = router.query('заполни форму регистрации', 0.15);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].id).toBe('forms');
  });

  it('handles stem and subword variations', () => {
    const matches = router.query('сохранить файл таблицы', 0.15);
    expect(matches.some((m) => m.id === 'sheets' || m.id === 'downloader')).toBe(true);
  });

  it('returns empty list for completely unrelated queries with high threshold', () => {
    const matches = router.query('абсолютно несвязанный текст о погоде', 0.45);
    expect(matches.length).toBe(0);
  });
});
