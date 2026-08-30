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

  it('detects Cloudflare and interstitial bot challenge titles and URLs', () => {
    expect(isBotChallengePage('Just a moment...', 'https://example.com/login')).toBe(true);
    expect(isBotChallengePage('Attention Required! | Cloudflare', 'https://example.com')).toBe(true);
    expect(isBotChallengePage('Security Check', 'https://example.com')).toBe(true);
    expect(isBotChallengePage('Verify you are human', 'https://example.com')).toBe(true);
    expect(isBotChallengePage('Checking your browser', 'https://example.com')).toBe(true);
    expect(isBotChallengePage('Cloudflare Bot Challenge', 'https://example.com')).toBe(true);
    expect(isBotChallengePage('Normal Title', 'https://challenges.cloudflare.com/challenge-platform')).toBe(true);
  });

  it('returns false for ordinary pages even with recaptcha/hcaptcha in content', () => {
    expect(isBotChallengePage('Google Search', 'https://google.com', '<div>search results</div>')).toBe(false);
    expect(isBotChallengePage('Online Store - Home', 'https://shop.com')).toBe(false);
    expect(isBotChallengePage('Kit Digital autónomos: cómo conseguirlo | Wolters Kluwer', 'https://www.wolterskluwer.com/es-es/expert-insights/kit-digital-autonomos')).toBe(false);
    expect(isBotChallengePage('Article about ReCAPTCHA and security', 'https://techblog.com/recaptcha-guide')).toBe(false);
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
    expect(mockExecuteScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 123, allFrames: true },
    }));
  });

  it('prefers an image challenge found inside a provider frame over its checkbox wrapper', async () => {
    const mockExecuteScript = vi.fn().mockResolvedValue([
      { result: { detected: true, type: 'recaptcha', details: 'Visible reCAPTCHA checkbox detected' } },
      { result: { detected: true, type: 'image', frameUrl: 'https://www.google.com/recaptcha/api2/bframe', details: 'Image-selection CAPTCHA challenge detected' } },
    ]);
    vi.stubGlobal('chrome', { scripting: { executeScript: mockExecuteScript } });

    const detection = await detectPageCaptcha(123);

    expect(detection.type).toBe('image');
    expect(detection.frameUrl).toContain('/recaptcha/api2/bframe');
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

  it.each([
    ['image', 'Image CAPTCHA'],
    ['slider', 'Slider/puzzle CAPTCHA'],
    ['audio', 'Audio CAPTCHA'],
  ] as const)('prepares a manual %s handoff without invoking checkbox solvers', async (type, label) => {
    const mockExecuteScript = vi.fn().mockResolvedValue([
      { result: { prepared: true, switchedToAudio: type === 'audio' } },
    ]);
    vi.stubGlobal('chrome', { scripting: { executeScript: mockExecuteScript } });

    const result = await solveCaptcha(123, type);

    expect(result).toMatchObject({ success: false, type });
    expect(result.message).toContain(label);
    expect(result.message).toContain('Human verification is required');
    expect(mockExecuteScript).toHaveBeenCalledTimes(1);
    expect(mockExecuteScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 123, allFrames: true },
      args: [type],
    }));
  });
});

