import { describe, expect, it } from 'vitest';
import { isBotChallengePage } from './captcha-solver';

describe('captcha-solver', () => {
  it('detects Cloudflare Turnstile titles and snippets', () => {
    expect(isBotChallengePage('Just a moment...', 'https://example.com/login')).toBe(true);
    expect(isBotChallengePage('Attention Required! | Cloudflare', 'https://example.com')).toBe(true);
    expect(isBotChallengePage('Security Check', 'https://example.com')).toBe(true);
    expect(isBotChallengePage('Normal Page Title', 'https://example.com', '<div class="cf-turnstile"></div>')).toBe(true);
  });

  it('returns false for ordinary pages', () => {
    expect(isBotChallengePage('Google Search', 'https://google.com', '<div>search results</div>')).toBe(false);
    expect(isBotChallengePage('Online Store - Home', 'https://shop.com')).toBe(false);
  });
});
