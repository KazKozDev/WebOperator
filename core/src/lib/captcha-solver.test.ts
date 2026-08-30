import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectPageCaptcha,
  isBotChallengePage,
  solveCaptcha,
  solveCloudflareChallenge,
  solveHcaptchaChallenge,
  solveRecaptchaChallenge,
} from './captcha-solver';

describe('captcha-solver', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects Cloudflare, reCAPTCHA, and hCaptcha titles and snippets', () => {
    expect(isBotChallengePage('Just a moment...', 'https://example.com/login')).toBe(true);
    expect(isBotChallengePage('Attention Required! | Cloudflare', 'https://example.com')).toBe(true);
    expect(isBotChallengePage('Security Check', 'https://example.com')).toBe(true);
    expect(isBotChallengePage('Normal Page Title', 'https://example.com', '<div class="cf-turnstile"></div>')).toBe(true);
    expect(isBotChallengePage('Login', 'https://example.com', '<div class="g-recaptcha"></div>')).toBe(true);
    expect(isBotChallengePage('Verify', 'https://example.com', '<div class="h-captcha"></div>')).toBe(true);
    expect(isBotChallengePage('Bot Challenge Page', 'https://example.com')).toBe(true);
  });

  it('returns false for ordinary pages', () => {
    expect(isBotChallengePage('Google Search', 'https://google.com', '<div>search results</div>')).toBe(false);
    expect(isBotChallengePage('Online Store - Home', 'https://shop.com')).toBe(false);
  });

  it('detects page captchas via detectPageCaptcha', async () => {
    const mockExecuteScript = vi.fn().mockResolvedValue([
      { result: { detected: true, type: 'cloudflare', details: 'Cloudflare detected' } },
    ]);
    vi.stubGlobal('chrome', {
      scripting: {
        executeScript: mockExecuteScript,
      },
    });

    const detection = await detectPageCaptcha(123);
    expect(detection.detected).toBe(true);
    expect(detection.type).toBe('cloudflare');
  });

  it('handles solveCloudflareChallenge with chrome scripting mock', async () => {
    const mockExecuteScript = vi.fn().mockResolvedValue([
      { result: { clickedCheckbox: true } },
    ]);
    vi.stubGlobal('chrome', {
      scripting: {
        executeScript: mockExecuteScript,
      },
    });

    const res = await solveCloudflareChallenge(123);
    expect(res.success).toBe(true);
    expect(res.message).toContain('clicked successfully');
  });

  it('handles solveRecaptchaChallenge with chrome scripting mock', async () => {
    const mockExecuteScript = vi.fn().mockResolvedValue([
      { result: { clickedCheckbox: true } },
    ]);
    vi.stubGlobal('chrome', {
      scripting: {
        executeScript: mockExecuteScript,
      },
    });

    const res = await solveRecaptchaChallenge(123);
    expect(res.success).toBe(true);
    expect(res.message).toContain('reCAPTCHA checkbox clicked');
  });

  it('handles solveHcaptchaChallenge with chrome scripting mock', async () => {
    const mockExecuteScript = vi.fn().mockResolvedValue([
      { result: { clickedCheckbox: true } },
    ]);
    vi.stubGlobal('chrome', {
      scripting: {
        executeScript: mockExecuteScript,
      },
    });

    const res = await solveHcaptchaChallenge(123);
    expect(res.success).toBe(true);
    expect(res.message).toContain('hCaptcha checkbox clicked');
  });

  it('dispatches solveCaptcha correctly by type', async () => {
    const mockExecuteScript = vi.fn().mockResolvedValue([
      { result: { clickedCheckbox: true } },
    ]);
    vi.stubGlobal('chrome', {
      scripting: {
        executeScript: mockExecuteScript,
      },
    });

    const resCloudflare = await solveCaptcha(123, 'cloudflare');
    expect(resCloudflare.success).toBe(true);
    expect(resCloudflare.type).toBe('cloudflare');

    const resRecaptcha = await solveCaptcha(123, 'recaptcha');
    expect(resRecaptcha.success).toBe(true);
    expect(resRecaptcha.type).toBe('recaptcha');

    const resImage = await solveCaptcha(123, 'image');
    expect(resImage.success).toBe(false);
    expect(resImage.type).toBe('image');
  });
});


