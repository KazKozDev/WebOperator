import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callCaptchaLLM,
  detectPageCaptcha,
  isBotChallengePage,
  solveAudioCaptcha,
  solveCaptcha,
  solveCloudflareChallenge,
  solveGenericChallenge,
  solveHcaptchaChallenge,
  solveHcaptchaImageChallenge,
  solvePowCaptcha,
  solvePressAndHold,
  solveRecaptchaChallenge,
  solveRecaptchaImageChallenge,
  solveSliderCaptcha,
  solveVisualTextCaptcha,
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

  it('detects an in-place PerimeterX challenge from the page body', () => {
    const title = 'Human Verification';
    const url = 'https://www.redfin.com/neighborhood/2212/WA/Seattle/Queen-Anne/recently-sold';
    const body = "Let's confirm you are human Complete the security check before continuing. "
      + 'This step verifies that you are not a bot, which helps to protect your account and prevent spam. Begin';
    expect(isBotChallengePage(title, url, body)).toBe(true);
    expect(isBotChallengePage(title, url)).toBe(true);
    expect(isBotChallengePage('Listings', url, body)).toBe(true);
    expect(isBotChallengePage('Press & Hold', 'https://example.com')).toBe(false);
    expect(isBotChallengePage('Listings', url, 'Press & Hold to confirm you are a human')).toBe(true);
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
    expect(res.message).toContain('checkbox clicked successfully');
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

  it('handles solveGenericChallenge with chrome scripting mock', async () => {
    const mockExecuteScript = vi.fn().mockResolvedValue([
      { result: { clicked: true, name: 'AWS WAF' } },
    ]);
    vi.stubGlobal('chrome', {
      scripting: {
        executeScript: mockExecuteScript,
      },
    });

    const res = await solveGenericChallenge(123);
    expect(res.success).toBe(true);
    expect(res.message).toContain('AWS WAF button clicked');
  });

  it('handles solveSliderCaptcha with chrome scripting mock', async () => {
    const mockExecuteScript = vi.fn()
      .mockResolvedValueOnce([
        { result: { found: true, trackWidth: 300, buttonWidth: 40, imageSrc: 'data:image/png;base64,mock' } },
      ])
      .mockResolvedValueOnce([
        { result: { dragged: true, distance: 155 } },
      ]);

    vi.stubGlobal('chrome', {
      scripting: {
        executeScript: mockExecuteScript,
      },
    });

    const mockLLM = vi.fn().mockResolvedValue('155');
    const res = await solveSliderCaptcha(123, { llmCaller: mockLLM });
    expect(res.success).toBe(true);
    expect(res.message).toContain('Slider puzzle dragged smoothly by 155px');
    expect(mockLLM).toHaveBeenCalled();
  });

  it('handles solveVisualTextCaptcha with fast-path attribute code', async () => {
    const mockExecuteScript = vi.fn().mockResolvedValue([
      { result: { found: true, solved: true, code: '7G9X' } },
    ]);
    vi.stubGlobal('chrome', {
      scripting: {
        executeScript: mockExecuteScript,
      },
    });

    const res = await solveVisualTextCaptcha(123);
    expect(res.success).toBe(true);
    expect(res.message).toContain('7G9X');
  });

  it('solves visual text captcha via LLM Vision OCR when image is extracted', async () => {
    const mockExecuteScript = vi.fn()
      .mockResolvedValueOnce([
        { result: { found: true, solved: false, imageBase64: 'data:image/png;base64,mockImage' } },
      ])
      .mockResolvedValueOnce([
        { result: undefined },
      ]);

    vi.stubGlobal('chrome', {
      scripting: {
        executeScript: mockExecuteScript,
      },
    });

    const mockLLM = vi.fn().mockResolvedValue('K9X4M');
    const res = await solveVisualTextCaptcha(123, { llmCaller: mockLLM });

    expect(res.success).toBe(true);
    expect(res.code).toBe('K9X4M');
    expect(res.message).toContain('K9X4M');
    expect(mockLLM).toHaveBeenCalled();
  });

  it('solves reCAPTCHA v2 image challenge via LLM Vision tile selection', async () => {
    const mockExecuteScript = vi.fn()
      // 1. extraction
      .mockResolvedValueOnce([
        {
          result: {
            found: true,
            instruction: 'Select all images with traffic lights',
            gridDim: 3,
            totalTiles: 9,
            imageSrc: 'data:image/jpeg;base64,mockTileGrid',
            hasTiles: true,
          },
        },
      ])
      // 2. tile clicking
      .mockResolvedValueOnce([{ result: undefined }])
      // 3. verify button click
      .mockResolvedValueOnce([{ result: undefined }])
      // 4. check if solved
      .mockResolvedValueOnce([{ result: { solved: true } }]);

    vi.stubGlobal('chrome', {
      scripting: {
        executeScript: mockExecuteScript,
      },
    });

    const mockLLM = vi.fn().mockResolvedValue('[1, 5, 9]');
    const res = await solveRecaptchaImageChallenge(123, { llmCaller: mockLLM });

    expect(res.success).toBe(true);
    expect(res.message).toContain('reCAPTCHA visual challenge solved');
    expect(mockLLM).toHaveBeenCalledWith(
      expect.stringContaining('Select all images with traffic lights'),
      ['data:image/jpeg;base64,mockTileGrid'],
    );
  });

  it('solves hCaptcha image challenge via LLM Vision selection', async () => {
    const mockExecuteScript = vi.fn()
      // Round 1 extraction
      .mockResolvedValueOnce([
        {
          result: {
            found: true,
            promptText: 'Please click each image containing a cat',
            taskCount: 9,
            imageUrls: ['http://example.com/cat1.jpg', 'http://example.com/cat2.jpg'],
          },
        },
      ])
      // Tile clicks
      .mockResolvedValueOnce([{ result: undefined }])
      // Submit click
      .mockResolvedValueOnce([{ result: undefined }])
      // Round 2 extraction - finished
      .mockResolvedValueOnce([
        { result: { found: false } },
      ]);

    vi.stubGlobal('chrome', {
      scripting: {
        executeScript: mockExecuteScript,
      },
    });

    const mockLLM = vi.fn().mockResolvedValue('[2, 4]');
    const res = await solveHcaptchaImageChallenge(123, { llmCaller: mockLLM });

    expect(res.success).toBe(true);
    expect(res.message).toContain('hCaptcha visual challenge executed');
    expect(mockLLM).toHaveBeenCalledWith(
      expect.stringContaining('Please click each image containing a cat'),
      ['http://example.com/cat1.jpg', 'http://example.com/cat2.jpg'],
    );
  });

  it('calls custom LLM caller in callCaptchaLLM', async () => {
    const mockLLM = vi.fn().mockResolvedValue('solved_code_123');
    const result = await callCaptchaLLM('Solve this', ['base64_data'], { llmCaller: mockLLM });
    expect(result).toBe('solved_code_123');
    expect(mockLLM).toHaveBeenCalledWith('Solve this', ['base64_data']);
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
  });

  it.each([
    ['audio', 'Audio CAPTCHA'],
    ['press_and_hold', 'Press & Hold'],
  ] as const)('prepares a manual %s handoff when automatic solver cannot resolve it', async (type, label) => {
    const mockExecuteScript = vi.fn().mockResolvedValue([
      { result: { prepared: true, switchedToAudio: type === 'audio' } },
    ]);
    vi.stubGlobal('chrome', { scripting: { executeScript: mockExecuteScript } });

    const result = await solveCaptcha(123, type);

    expect(result).toMatchObject({ success: false, type });
    expect(result.message).toContain(label);
    expect(result.message).toContain('Human verification is required');
    expect(mockExecuteScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 123, allFrames: true },
      args: [type],
    }));
  });

  it('solves audio CAPTCHA when audio data is available and transcribed', async () => {
    const mockExecuteScript = vi
      .fn()
      // 1. Preparation: audio found and extracted
      .mockResolvedValueOnce([
        {
          result: {
            audioBase64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=',
            mimeType: 'audio/wav',
          },
        },
      ])
      // 2. Submission: code entered and submitted
      .mockResolvedValueOnce([
        { result: { submitted: true } },
      ]);

    vi.stubGlobal('chrome', {
      scripting: {
        executeScript: mockExecuteScript,
      },
    });

    const mockLLM = vi.fn().mockResolvedValue('5 8 2 1 9 4');
    const res = await solveAudioCaptcha(123, { llmCaller: mockLLM });

    expect(res.success).toBe(true);
    expect(res.message).toContain('Audio CAPTCHA transcribed and submitted successfully');
    expect(mockLLM).toHaveBeenCalledWith(
      expect.stringContaining('Transcribe this audio CAPTCHA clip'),
      [expect.any(String)],
    );
  });

  it('solves Press and Hold challenge via simulated pointer actions or CDP', async () => {
    const mockExecuteScript = vi
      .fn()
      // 1. Target located
      .mockResolvedValueOnce([
        { result: { found: true, x: 150, y: 300 } },
      ])
      // 2. Fallback pointerdown hold dispatched
      .mockResolvedValueOnce([{ result: undefined }]);

    vi.stubGlobal('chrome', {
      scripting: {
        executeScript: mockExecuteScript,
      },
    });

    const res = await solvePressAndHold(123);
    expect(res.success).toBe(true);
    expect(res.message).toContain('Press and Hold');
  });

  it('solves Proof-of-Work (ALTCHA/Friendly Captcha) challenge via WebCrypto', async () => {
    const mockExecuteScript = vi.fn().mockResolvedValue([
      { result: { solved: true, type: 'altcha', number: 42 } },
    ]);

    vi.stubGlobal('chrome', {
      scripting: {
        executeScript: mockExecuteScript,
      },
    });

    const res = await solvePowCaptcha(123);
    expect(res.success).toBe(true);
    expect(res.message).toContain('Proof-of-Work challenge (altcha) successfully computed');
  });

  it('detects press_and_hold and pow in detectPageCaptcha', async () => {
    const mockExecuteScript = vi.fn().mockResolvedValue([
      { result: { detected: true, type: 'press_and_hold', details: 'Press and Hold detected' } },
    ]);

    vi.stubGlobal('chrome', {
      scripting: {
        executeScript: mockExecuteScript,
      },
    });

    const detection = await detectPageCaptcha(123);
    expect(detection.detected).toBe(true);
    expect(detection.type).toBe('press_and_hold');
  });
});
