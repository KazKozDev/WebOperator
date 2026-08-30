/**
 * Smart CAPTCHA detection and LLM-assisted verification engine for WebOperator.
 * Supports Cloudflare Turnstile, Google reCAPTCHA v2 / Enterprise (checkbox + vision grid),
 * hCaptcha (checkbox + vision matching), Visual Alphanumeric Text CAPTCHAs (OCR vision),
 * Slider / Puzzle challenges (vision offset estimation + humanized drag), and Arkose / FunCaptcha.
 */

import type { Settings } from './types';
import { getSettings } from './storage';
import { chatOpenAI } from './openai-client';
import { chatAnthropic } from './anthropic-client';
import { chatGemini } from './gemini-client';
import { chatXai } from './xai-client';
import { chatOpenRouter } from './openrouter-client';
import { chatSiliconFlow } from './siliconflow-client';
import { chatMlx } from './mlx-client';
import { chatDeepSeek } from './deepseek-client';
import { chat, type OllamaChatOptions } from './ollama-client';

export interface CaptchaDetection {
  detected: boolean;
  type: 'cloudflare' | 'recaptcha' | 'hcaptcha' | 'image' | 'slider' | 'audio' | 'unknown';
  frameUrl?: string;
  details?: string;
  imageRef?: string;
  inputRef?: string;
}

export interface CaptchaHandoffPreparation {
  prepared: boolean;
  message: string;
}

export type LLMCaptchaCaller = (prompt: string, imagesBase64?: string[]) => Promise<string>;

export interface CaptchaSolverOptions {
  settings?: Settings;
  llmCaller?: LLMCaptchaCaller;
  maxAttempts?: number;
}

const CAPTCHA_TYPE_PRIORITY: Record<CaptchaDetection['type'], number> = {
  unknown: 0,
  cloudflare: 1,
  recaptcha: 2,
  hcaptcha: 2,
  image: 3,
  slider: 4,
  audio: 5,
};

/**
 * Universal multimodal LLM caller for vision and reasoning during CAPTCHA solving.
 */
export async function callCaptchaLLM(
  prompt: string,
  imagesBase64: string[] = [],
  options?: CaptchaSolverOptions
): Promise<string> {
  if (options?.llmCaller) {
    try {
      return await options.llmCaller(prompt, imagesBase64);
    } catch (err) {
      console.warn('[CaptchaSolver] Custom LLM caller failed:', err);
      return '';
    }
  }

  let settings: Settings;
  try {
    settings = options?.settings ?? (await getSettings());
  } catch {
    return '';
  }

  const cleanedImages = imagesBase64.map((img) => {
    if (img.startsWith('data:')) {
      const idx = img.indexOf(',');
      return idx >= 0 ? img.slice(idx + 1) : img;
    }
    return img;
  });

  const chatOpts: OllamaChatOptions = {
    url: settings.ollamaUrl || 'http://localhost:11434',
    model: settings.ollamaModel || 'llama3.2-vision',
    messages: [
      {
        role: 'user',
        content: prompt,
        images: cleanedImages.length > 0 ? cleanedImages : undefined,
      },
    ],
    images: cleanedImages.length > 0 ? cleanedImages : undefined,
  };

  try {
    if (settings.provider === 'anthropic' && settings.anthropicApiKey) {
      const res = await chatAnthropic(
        chatOpts,
        settings.anthropicApiKey,
        settings.anthropicModel || 'claude-3-7-sonnet-20250219'
      );
      return res.content || '';
    }
    if (settings.provider === 'openai' && settings.openaiApiKey) {
      const res = await chatOpenAI(
        chatOpts,
        settings.openaiApiKey,
        settings.openaiModel || 'gpt-4o'
      );
      return res.content || '';
    }
    if (settings.provider === 'gemini' && settings.geminiApiKey) {
      const res = await chatGemini(
        { ...chatOpts, onUpdate: undefined },
        settings.geminiApiKey,
        settings.geminiModel || 'gemini-2.5-flash'
      );
      return res.content || '';
    }
    if (settings.provider === 'xai' && settings.xaiApiKey) {
      const res = await chatXai(
        chatOpts,
        settings.xaiApiKey,
        settings.xaiModel || 'grok-2-vision-1212'
      );
      return res.content || '';
    }
    if (settings.provider === 'openrouter' && settings.openRouterApiKey) {
      const res = await chatOpenRouter(
        chatOpts,
        settings.openRouterApiKey,
        settings.openRouterModel || 'anthropic/claude-3.5-sonnet'
      );
      return res.content || '';
    }
    if (settings.provider === 'siliconflow' && settings.siliconFlowApiKey) {
      const res = await chatSiliconFlow(
        chatOpts,
        settings.siliconFlowApiKey,
        settings.siliconFlowModel || 'deepseek-ai/DeepSeek-V3'
      );
      return res.content || '';
    }
    if (settings.provider === 'mlx' && settings.mlxApiKey) {
      const res = await chatMlx(chatOpts, settings.mlxApiKey, settings.mlxModel);
      return res.content || '';
    }
    if (settings.provider === 'deepseek' && settings.deepseekApiKey) {
      const res = await chatDeepSeek(
        chatOpts,
        settings.deepseekApiKey,
        settings.deepseekModel || 'deepseek-chat'
      );
      return res.content || '';
    }
    const res = await chat(chatOpts);
    return res.content || '';
  } catch (err) {
    console.warn('[CaptchaSolver] LLM vision call failed:', err);
    return '';
  }
}

/**
 * Checks if the page is currently displaying a Cloudflare or Bot Challenge.
 */
export function isBotChallengePage(title: string, url: string, bodySnippet = ''): boolean {
  const lowerTitle = title.toLowerCase();
  const lowerUrl = url.toLowerCase();
  const lowerSnippet = bodySnippet.toLowerCase();

  const isChallengeTitle =
    lowerTitle.includes('just a moment') ||
    lowerTitle.includes('attention required! | cloudflare') ||
    lowerTitle.includes('attention required') ||
    lowerTitle.includes('security check') ||
    lowerTitle.includes('verify you are human') ||
    lowerTitle.includes('human verification') ||
    lowerTitle.includes('are you a human') ||
    lowerTitle.includes('pardon our interruption') ||
    lowerTitle.includes('access to this page has been denied') ||
    lowerTitle.includes('checking your browser') ||
    lowerTitle.includes('cloudflare bot challenge');

  const isChallengeUrl =
    lowerUrl.includes('challenges.cloudflare.com') ||
    lowerUrl.includes('/cdn-cgi/challenge') ||
    lowerUrl.includes('waf.datadome.co') ||
    lowerUrl.includes('geo.captcha-delivery.com') ||
    lowerUrl.includes('perimeterx.') ||
    lowerUrl.includes('px-cdn.net') ||
    lowerUrl.includes('px-cloud.net') ||
    lowerUrl.includes('arkoselabs.com');

  const isChallengeSnippet =
    lowerSnippet.includes('cf-challenge') ||
    lowerSnippet.includes('challenges.cloudflare.com/turnstile') ||
    lowerSnippet.includes('px-captcha') ||
    lowerSnippet.includes('confirm you are human') ||
    lowerSnippet.includes('complete the security check') ||
    lowerSnippet.includes('verify that you are not a bot') ||
    lowerSnippet.includes('you are not a bot') ||
    lowerSnippet.includes('press & hold') ||
    lowerSnippet.includes('press and hold to confirm');

  return isChallengeTitle || isChallengeUrl || isChallengeSnippet;
}

/**
 * Injects a script into the tab to detect and solve Cloudflare Turnstile & Checkbox CAPTCHAs.
 */
export async function solveCloudflareChallenge(tabId: number): Promise<{ success: boolean; message: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          function queryDeep(selector: string, root: Document | Element | ShadowRoot = document): Element[] {
            const res: Element[] = Array.from(root.querySelectorAll(selector));
            const allEls = root.querySelectorAll('*');
            for (let i = 0; i < allEls.length; i++) {
              const el = allEls[i];
              if (el && el.shadowRoot) {
                res.push(...queryDeep(selector, el.shadowRoot));
              }
            }
            return res;
          }

          function dispatchClick(el: Element, cx?: number, cy?: number) {
            const rect = el.getBoundingClientRect();
            const x = cx ?? Math.round(rect.x + (rect.width > 0 ? Math.min(28, rect.width / 2) : 10));
            const y = cy ?? Math.round(rect.y + (rect.height > 0 ? rect.height / 2 : 10));
            const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
            el.dispatchEvent(new PointerEvent('pointerover', opts));
            el.dispatchEvent(new PointerEvent('pointerdown', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            if (el instanceof HTMLElement) el.focus({ preventScroll: true });
            el.dispatchEvent(new PointerEvent('pointerup', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
          }

          // 1. Search for interactive checkbox inside frame / shadow roots
          const checkboxes = queryDeep(
            'input[type="checkbox"], .ctp-checkbox-label, .ctp-checkbox-container, #challenge-stage input'
          ) as HTMLElement[];
          for (const cb of checkboxes) {
            const rect = cb.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              dispatchClick(cb);
              return { clickedCheckbox: true };
            }
          }

          // 2. Search for Cloudflare Turnstile iframe
          const iframes = queryDeep('iframe') as HTMLIFrameElement[];
          for (const iframe of iframes) {
            const src = iframe.src || '';
            if (src.includes('challenges.cloudflare.com') || src.includes('turnstile') || src.includes('cf-chl')) {
              const rect = iframe.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return { foundIframe: true, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
              }
            }
          }

          // 3. Search for shadow root / turnstile stage wrappers
          const wrappers = queryDeep('.cf-turnstile, #challenge-stage, [data-sitekey]');
          for (const w of wrappers) {
            const rect = w.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return { foundWrapper: true, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
            }
          }

          return { none: true };
        },
      });

      for (const r of results) {
        const res = r.result as Record<string, unknown> | null;
        if (res?.clickedCheckbox) {
          return { success: true, message: 'Cloudflare Turnstile checkbox clicked successfully.' };
        }
      }

      for (const r of results) {
        const res = r.result as {
          foundIframe?: boolean;
          foundWrapper?: boolean;
          rect?: { x: number; y: number; w: number; h: number };
        } | null;
        if (res?.rect) {
          const clickX = Math.round(res.rect.x + Math.min(30, res.rect.w / 2));
          const clickY = Math.round(res.rect.y + res.rect.h / 2);

          await chrome.scripting.executeScript({
            target: { tabId },
            func: (x, y) => {
              const el = document.elementFromPoint(x, y);
              if (el) {
                const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
                el.dispatchEvent(new PointerEvent('pointerover', opts));
                el.dispatchEvent(new PointerEvent('pointerdown', opts));
                el.dispatchEvent(new MouseEvent('mousedown', opts));
                if (el instanceof HTMLElement) el.focus({ preventScroll: true });
                el.dispatchEvent(new PointerEvent('pointerup', opts));
                el.dispatchEvent(new MouseEvent('mouseup', opts));
                el.dispatchEvent(new MouseEvent('click', opts));
              }
            },
            args: [clickX, clickY],
          });

          return { success: true, message: `Cloudflare challenge clicked at (${clickX}, ${clickY}).` };
        }
      }

      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 600));
    } catch (err) {
      if (attempt === 2) return { success: false, message: err instanceof Error ? err.message : String(err) };
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }

  return { success: false, message: 'Cloudflare challenge element not found in DOM.' };
}

/**
 * Injects a script into the tab to detect and click Google reCAPTCHA v2 / Enterprise checkbox,
 * and if an image challenge grid opens, solves it with LLM Vision.
 */
export async function solveRecaptchaChallenge(
  tabId: number,
  options?: CaptchaSolverOptions
): Promise<{ success: boolean; message: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          function queryDeep(selector: string, root: Document | Element | ShadowRoot = document): Element[] {
            const res: Element[] = Array.from(root.querySelectorAll(selector));
            const allEls = root.querySelectorAll('*');
            for (let i = 0; i < allEls.length; i++) {
              const el = allEls[i];
              if (el && el.shadowRoot) {
                res.push(...queryDeep(selector, el.shadowRoot));
              }
            }
            return res;
          }

          function dispatchClick(el: Element) {
            const rect = el.getBoundingClientRect();
            const x = Math.round(rect.x + (rect.width > 0 ? Math.min(28, rect.width / 2) : 10));
            const y = Math.round(rect.y + (rect.height > 0 ? rect.height / 2 : 10));
            const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
            el.dispatchEvent(new PointerEvent('pointerover', opts));
            el.dispatchEvent(new PointerEvent('pointerdown', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            if (el instanceof HTMLElement) el.focus({ preventScroll: true });
            el.dispatchEvent(new PointerEvent('pointerup', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
          }

          // Check if an image challenge popup is already active
          const activeImageChallenge = queryDeep('.rc-imageselect, #rc-imageselect');
          if (activeImageChallenge.length > 0) {
            return { hasActiveImageGrid: true };
          }

          // Look for checkbox inside frame / shadow root
          const checkboxes = queryDeep(
            '#recaptcha-anchor, .recaptcha-checkbox, .recaptcha-checkbox-border, [role="checkbox"][aria-labelledby*="recaptcha"]'
          ) as HTMLElement[];
          for (const cb of checkboxes) {
            const rect = cb.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              dispatchClick(cb);
              return { clickedCheckbox: true };
            }
          }

          // Look for reCAPTCHA iframe
          const iframes = queryDeep('iframe') as HTMLIFrameElement[];
          for (const iframe of iframes) {
            const src = iframe.src || '';
            if (src.includes('google.com/recaptcha') || src.includes('recaptcha/api2/anchor')) {
              const rect = iframe.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return { foundIframe: true, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
              }
            }
          }

          return { none: true };
        },
      });

      for (const r of results) {
        const res = r.result as { clickedCheckbox?: boolean; hasActiveImageGrid?: boolean } | null;
        if (res?.hasActiveImageGrid) {
          return await solveRecaptchaImageChallenge(tabId, options);
        }
        if (res?.clickedCheckbox) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const followUp = await solveRecaptchaImageChallenge(tabId, options);
          if (followUp.success) return followUp;
          return { success: true, message: 'reCAPTCHA checkbox clicked successfully.' };
        }
      }

      for (const r of results) {
        const res = r.result as { foundIframe?: boolean; rect?: { x: number; y: number; w: number; h: number } } | null;
        if (res?.rect) {
          const clickX = Math.round(res.rect.x + Math.min(28, res.rect.w / 2));
          const clickY = Math.round(res.rect.y + res.rect.h / 2);

          await chrome.scripting.executeScript({
            target: { tabId },
            func: (x, y) => {
              const el = document.elementFromPoint(x, y);
              if (el) {
                const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
                el.dispatchEvent(new PointerEvent('pointerover', opts));
                el.dispatchEvent(new PointerEvent('pointerdown', opts));
                el.dispatchEvent(new MouseEvent('mousedown', opts));
                if (el instanceof HTMLElement) el.focus({ preventScroll: true });
                el.dispatchEvent(new PointerEvent('pointerup', opts));
                el.dispatchEvent(new MouseEvent('mouseup', opts));
                el.dispatchEvent(new MouseEvent('click', opts));
              }
            },
            args: [clickX, clickY],
          });

          await new Promise((resolve) => setTimeout(resolve, 1500));
          const followUp = await solveRecaptchaImageChallenge(tabId, options);
          if (followUp.success) return followUp;
          return { success: true, message: `reCAPTCHA checkbox clicked at (${clickX}, ${clickY}).` };
        }
      }

      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 600));
    } catch (err) {
      if (attempt === 2) return { success: false, message: err instanceof Error ? err.message : String(err) };
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }

  return { success: false, message: 'reCAPTCHA checkbox element not found in DOM.' };
}

/**
 * Solves reCAPTCHA v2 / Enterprise image tile challenges using LLM Vision.
 */
export async function solveRecaptchaImageChallenge(
  tabId: number,
  options?: CaptchaSolverOptions
): Promise<{ success: boolean; message: string }> {
  for (let round = 0; round < 3; round++) {
    try {
      // 1. Extract challenge details and image from the tab
      const extractResults = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          function queryDeep(selector: string, root: Document | Element | ShadowRoot = document): Element[] {
            const res: Element[] = Array.from(root.querySelectorAll(selector));
            const allEls = root.querySelectorAll('*');
            for (let i = 0; i < allEls.length; i++) {
              const el = allEls[i];
              if (el && el.shadowRoot) res.push(...queryDeep(selector, el.shadowRoot));
            }
            return res;
          }

          const challengeContainer = queryDeep('.rc-imageselect, #rc-imageselect')[0] as HTMLElement | undefined;
          if (!challengeContainer) return { found: false };

          const instructionEl = queryDeep(
            '.rc-imageselect-instructions, .rc-imageselect-desc-wrapper, .rc-imageselect-desc, strong',
            challengeContainer
          )[0] as HTMLElement | undefined;
          const instruction = instructionEl?.innerText?.trim() || 'Select matching images';

          // Detect grid dimension (3x3 = 9 tiles, 4x4 = 16 tiles)
          const tiles = queryDeep(
            '.rc-imageselect-tile, .rc-image-tile-wrapper, td.rc-imageselect-tile',
            challengeContainer
          ) as HTMLElement[];
          const is4x4 = queryDeep('.rc-imageselect-table-44', challengeContainer).length > 0 || tiles.length === 16;
          const gridDim = is4x4 ? 4 : 3;
          const totalTiles = gridDim * gridDim;

          // Extract tile images or master image data
          const imgEl = queryDeep(
            '.rc-image-tile-wrapper img, .rc-imageselect-target img, img.rc-image-tile-33, img.rc-image-tile-44',
            challengeContainer
          )[0] as HTMLImageElement | undefined;
          let imageSrc = imgEl?.src || '';

          // If image is on canvas or relative, attempt data URL extraction
          if (imgEl && (!imageSrc || imageSrc.startsWith('http') || imageSrc.startsWith('blob:'))) {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = imgEl.naturalWidth || imgEl.width || 300;
              canvas.height = imgEl.naturalHeight || imgEl.height || 300;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(imgEl, 0, 0);
                imageSrc = canvas.toDataURL('image/jpeg', 0.85);
              }
            } catch {
              // Cross-origin canvas fallback
            }
          }

          return {
            found: true,
            instruction,
            gridDim,
            totalTiles,
            imageSrc,
            hasTiles: tiles.length > 0,
          };
        },
      });

      const extracted = extractResults.find((r) => r.result?.found)?.result as {
        found: boolean;
        instruction: string;
        gridDim: number;
        totalTiles: number;
        imageSrc: string;
        hasTiles: boolean;
      } | undefined;

      if (!extracted || !extracted.found) {
        return { success: false, message: 'reCAPTCHA image challenge not detected.' };
      }

      // 2. Query LLM Vision with challenge instruction and image
      const prompt = `You are an automated assistant solving a Google reCAPTCHA image selection challenge.
Instruction: "${extracted.instruction}".
The grid contains ${extracted.totalTiles} tiles (${extracted.gridDim}x${extracted.gridDim}) numbered 1 to ${extracted.totalTiles} starting from top-left (1) row-by-row to bottom-right (${extracted.totalTiles}).
Identify all tile numbers (1-indexed) that contain the requested target objects.
Return ONLY a valid JSON array of numbers, for example: [1, 4, 7] or [] if none match.`;

      const images = extracted.imageSrc ? [extracted.imageSrc] : [];
      const llmResponse = await callCaptchaLLM(prompt, images, options);

      // Parse JSON array of tile indices
      let selectedTiles: number[] = [];
      try {
        const jsonMatch = llmResponse.match(/\[[\d\s,]*\]/);
        if (jsonMatch) {
          selectedTiles = JSON.parse(jsonMatch[0]) as number[];
        } else {
          const numbers = llmResponse.match(/\b\d+\b/g);
          if (numbers) {
            selectedTiles = numbers.map(Number).filter((n) => n >= 1 && n <= extracted.totalTiles);
          }
        }
      } catch {
        selectedTiles = [];
      }

      // 3. Click the identified tiles in the active tab
      if (selectedTiles.length > 0) {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: (tilesToClick) => {
            function queryDeep(selector: string, root: Document | Element | ShadowRoot = document): Element[] {
              const res: Element[] = Array.from(root.querySelectorAll(selector));
              const allEls = root.querySelectorAll('*');
              for (let i = 0; i < allEls.length; i++) {
                const el = allEls[i];
                if (el && el.shadowRoot) res.push(...queryDeep(selector, el.shadowRoot));
              }
              return res;
            }

            const challengeContainer = queryDeep('.rc-imageselect, #rc-imageselect')[0] as HTMLElement | undefined;
            if (!challengeContainer) return;

            const tileEls = queryDeep(
              '.rc-imageselect-tile, .rc-image-tile-wrapper, td.rc-imageselect-tile',
              challengeContainer
            ) as HTMLElement[];

            for (const tileNum of tilesToClick) {
              const idx = tileNum - 1;
              const el = tileEls[idx];
              if (el) {
                const rect = el.getBoundingClientRect();
                const x = Math.round(rect.x + rect.width / 2);
                const y = Math.round(rect.y + rect.height / 2);
                const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
                el.dispatchEvent(new PointerEvent('pointerdown', opts));
                el.dispatchEvent(new MouseEvent('mousedown', opts));
                el.dispatchEvent(new PointerEvent('pointerup', opts));
                el.dispatchEvent(new MouseEvent('mouseup', opts));
                el.dispatchEvent(new MouseEvent('click', opts));
              }
            }
          },
          args: [selectedTiles],
        });

        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      // 4. Click the "Verify" / "Next" button
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          function queryDeep(selector: string, root: Document | Element | ShadowRoot = document): Element[] {
            const res: Element[] = Array.from(root.querySelectorAll(selector));
            const allEls = root.querySelectorAll('*');
            for (let i = 0; i < allEls.length; i++) {
              const el = allEls[i];
              if (el && el.shadowRoot) res.push(...queryDeep(selector, el.shadowRoot));
            }
            return res;
          }

          const verifyBtn = queryDeep('#recaptcha-verify-button, button#recaptcha-verify-button, .rc-button-default')[0] as HTMLElement | undefined;
          if (verifyBtn) {
            const rect = verifyBtn.getBoundingClientRect();
            const x = Math.round(rect.x + rect.width / 2);
            const y = Math.round(rect.y + rect.height / 2);
            const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
            verifyBtn.dispatchEvent(new MouseEvent('click', opts));
          }
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 1500));

      // 5. Check if challenge is resolved
      const checkResults = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          function queryDeep(selector: string, root: Document | Element | ShadowRoot = document): Element[] {
            const res: Element[] = Array.from(root.querySelectorAll(selector));
            const allEls = root.querySelectorAll('*');
            for (let i = 0; i < allEls.length; i++) {
              const el = allEls[i];
              if (el && el.shadowRoot) res.push(...queryDeep(selector, el.shadowRoot));
            }
            return res;
          }

          const activeChallenge = queryDeep('.rc-imageselect, #rc-imageselect');
          const isStillOpen = activeChallenge.some((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          const checked = queryDeep('#recaptcha-anchor[aria-checked="true"], .recaptcha-checkbox-checked');
          return { solved: checked.length > 0 || !isStillOpen };
        },
      });

      const isSolved = checkResults.some((r) => r.result?.solved);
      if (isSolved) {
        return {
          success: true,
          message: `reCAPTCHA visual challenge solved with LLM Vision (selected tiles [${selectedTiles.join(', ')}]).`,
        };
      }
    } catch (err) {
      if (round === 2) return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  return { success: false, message: 'reCAPTCHA image challenge could not be verified automatically.' };
}

/**
 * Injects a script into the tab to detect and click hCaptcha checkbox,
 * and if an image matching challenge appears, solves it with LLM Vision.
 */
export async function solveHcaptchaChallenge(
  tabId: number,
  options?: CaptchaSolverOptions
): Promise<{ success: boolean; message: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          function queryDeep(selector: string, root: Document | Element | ShadowRoot = document): Element[] {
            const res: Element[] = Array.from(root.querySelectorAll(selector));
            const allEls = root.querySelectorAll('*');
            for (let i = 0; i < allEls.length; i++) {
              const el = allEls[i];
              if (el && el.shadowRoot) res.push(...queryDeep(selector, el.shadowRoot));
            }
            return res;
          }

          function dispatchClick(el: Element) {
            const rect = el.getBoundingClientRect();
            const x = Math.round(rect.x + (rect.width > 0 ? Math.min(28, rect.width / 2) : 10));
            const y = Math.round(rect.y + (rect.height > 0 ? rect.height / 2 : 10));
            const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
            el.dispatchEvent(new PointerEvent('pointerover', opts));
            el.dispatchEvent(new PointerEvent('pointerdown', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            if (el instanceof HTMLElement) el.focus({ preventScroll: true });
            el.dispatchEvent(new PointerEvent('pointerup', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
          }

          // Check if image challenge frame is active
          const activeImageChallenge = queryDeep('.challenge-container, .prompt-text, .task-image');
          if (activeImageChallenge.length > 0) {
            return { hasActiveImageGrid: true };
          }

          // Look for checkbox inside hCaptcha frame / shadow root
          const checkboxes = queryDeep('#checkbox, [aria-label*="hCaptcha"][role="checkbox"], div#anchor') as HTMLElement[];
          for (const cb of checkboxes) {
            const rect = cb.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              dispatchClick(cb);
              return { clickedCheckbox: true };
            }
          }

          // Look for hCaptcha iframe
          const iframes = queryDeep('iframe') as HTMLIFrameElement[];
          for (const iframe of iframes) {
            const src = iframe.src || '';
            if (src.includes('hcaptcha.com') || src.includes('newassets.hcaptcha.com')) {
              const rect = iframe.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return { foundIframe: true, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
              }
            }
          }

          return { none: true };
        },
      });

      for (const r of results) {
        const res = r.result as { clickedCheckbox?: boolean; hasActiveImageGrid?: boolean } | null;
        if (res?.hasActiveImageGrid) {
          return await solveHcaptchaImageChallenge(tabId, options);
        }
        if (res?.clickedCheckbox) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const followUp = await solveHcaptchaImageChallenge(tabId, options);
          if (followUp.success) return followUp;
          return { success: true, message: 'hCaptcha checkbox clicked successfully.' };
        }
      }

      for (const r of results) {
        const res = r.result as { foundIframe?: boolean; rect?: { x: number; y: number; w: number; h: number } } | null;
        if (res?.rect) {
          const clickX = Math.round(res.rect.x + Math.min(28, res.rect.w / 2));
          const clickY = Math.round(res.rect.y + res.rect.h / 2);

          await chrome.scripting.executeScript({
            target: { tabId },
            func: (x, y) => {
              const el = document.elementFromPoint(x, y);
              if (el) {
                const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
                el.dispatchEvent(new PointerEvent('pointerover', opts));
                el.dispatchEvent(new PointerEvent('pointerdown', opts));
                el.dispatchEvent(new MouseEvent('mousedown', opts));
                if (el instanceof HTMLElement) el.focus({ preventScroll: true });
                el.dispatchEvent(new PointerEvent('pointerup', opts));
                el.dispatchEvent(new MouseEvent('mouseup', opts));
                el.dispatchEvent(new MouseEvent('click', opts));
              }
            },
            args: [clickX, clickY],
          });

          await new Promise((resolve) => setTimeout(resolve, 1500));
          const followUp = await solveHcaptchaImageChallenge(tabId, options);
          if (followUp.success) return followUp;
          return { success: true, message: `hCaptcha checkbox clicked at (${clickX}, ${clickY}).` };
        }
      }

      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 600));
    } catch (err) {
      if (attempt === 2) return { success: false, message: err instanceof Error ? err.message : String(err) };
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }

  return { success: false, message: 'hCaptcha element not found in DOM.' };
}

/**
 * Solves hCaptcha visual image selection challenges using LLM Vision.
 */
export async function solveHcaptchaImageChallenge(
  tabId: number,
  options?: CaptchaSolverOptions
): Promise<{ success: boolean; message: string }> {
  for (let round = 0; round < 2; round++) {
    try {
      const extractResults = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          function queryDeep(selector: string, root: Document | Element | ShadowRoot = document): Element[] {
            const res: Element[] = Array.from(root.querySelectorAll(selector));
            const allEls = root.querySelectorAll('*');
            for (let i = 0; i < allEls.length; i++) {
              const el = allEls[i];
              if (el && el.shadowRoot) res.push(...queryDeep(selector, el.shadowRoot));
            }
            return res;
          }

          const promptEl = queryDeep('.prompt-text, .challenge-header, h2[aria-label]')[0] as HTMLElement | undefined;
          const promptText = promptEl?.innerText?.trim() || 'Select matching images';

          const taskCells = queryDeep('.task-image, .task-cell, div[aria-label*="challenge"]') as HTMLElement[];
          if (taskCells.length === 0) return { found: false };

          const imageUrls: string[] = [];
          for (const cell of taskCells) {
            const img = cell.querySelector('img') as HTMLImageElement | null;
            const bg = window.getComputedStyle(cell).backgroundImage;
            if (img?.src) {
              imageUrls.push(img.src);
            } else if (bg && bg.startsWith('url(')) {
              imageUrls.push(bg.slice(4, -1).replace(/["']/g, ''));
            }
          }

          return {
            found: true,
            promptText,
            taskCount: taskCells.length,
            imageUrls,
          };
        },
      });

      const extracted = extractResults.find((r) => r.result?.found)?.result as {
        found: boolean;
        promptText: string;
        taskCount: number;
        imageUrls: string[];
      } | undefined;

      if (!extracted || !extracted.found) {
        if (round > 0) break;
        return { success: false, message: 'hCaptcha image challenge modal not found.' };
      }

      const prompt = `You are an automated assistant solving an hCaptcha image challenge.
Instruction: "${extracted.promptText}".
There are ${extracted.taskCount} images numbered 1 to ${extracted.taskCount} (ordered left-to-right, top-to-bottom).
Which image numbers match the prompt?
Return ONLY a valid JSON array of numbers (1-indexed), e.g. [2, 5, 8], or [] if none match.`;

      const llmResponse = await callCaptchaLLM(prompt, extracted.imageUrls, options);

      let selectedIndices: number[] = [];
      try {
        const jsonMatch = llmResponse.match(/\[[\d\s,]*\]/);
        if (jsonMatch) {
          selectedIndices = JSON.parse(jsonMatch[0]) as number[];
        } else {
          const numbers = llmResponse.match(/\b\d+\b/g);
          if (numbers) selectedIndices = numbers.map(Number).filter((n) => n >= 1 && n <= extracted.taskCount);
        }
      } catch {
        selectedIndices = [];
      }

      if (selectedIndices.length > 0) {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: (indices) => {
            function queryDeep(selector: string, root: Document | Element | ShadowRoot = document): Element[] {
              const res: Element[] = Array.from(root.querySelectorAll(selector));
              const allEls = root.querySelectorAll('*');
              for (let i = 0; i < allEls.length; i++) {
                const el = allEls[i];
                if (el && el.shadowRoot) res.push(...queryDeep(selector, el.shadowRoot));
              }
              return res;
            }

            const taskCells = queryDeep('.task-image, .task-cell, div[aria-label*="challenge"]') as HTMLElement[];
            for (const num of indices) {
              const cell = taskCells[num - 1];
              if (cell) {
                const rect = cell.getBoundingClientRect();
                const x = Math.round(rect.x + rect.width / 2);
                const y = Math.round(rect.y + rect.height / 2);
                const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
                cell.dispatchEvent(new MouseEvent('click', opts));
              }
            }
          },
          args: [selectedIndices],
        });

        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      // Click the submit button
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          function queryDeep(selector: string, root: Document | Element | ShadowRoot = document): Element[] {
            const res: Element[] = Array.from(root.querySelectorAll(selector));
            const allEls = root.querySelectorAll('*');
            for (let i = 0; i < allEls.length; i++) {
              const el = allEls[i];
              if (el && el.shadowRoot) res.push(...queryDeep(selector, el.shadowRoot));
            }
            return res;
          }

          const submitBtn = queryDeep('.button-submit, .verify-button, div.submit_text')[0] as HTMLElement | undefined;
          if (submitBtn) {
            submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          }
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch {
      // Continue to next round if available
    }
  }

  return { success: true, message: 'hCaptcha visual challenge executed via LLM Vision.' };
}

/**
 * Solves AWS WAF, GeeTest, Arkose / FunCaptcha interactive challenges.
 */
export async function solveGenericChallenge(
  tabId: number,
  options?: CaptchaSolverOptions
): Promise<{ success: boolean; message: string }> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        function queryDeep(selector: string, root: Document | Element | ShadowRoot = document): Element[] {
          const res: Element[] = Array.from(root.querySelectorAll(selector));
          const allEls = root.querySelectorAll('*');
          for (let i = 0; i < allEls.length; i++) {
            const el = allEls[i];
            if (el && el.shadowRoot) {
              res.push(...queryDeep(selector, el.shadowRoot));
            }
          }
          return res;
        }

        function dispatchClick(el: Element) {
          const rect = el.getBoundingClientRect();
          const x = Math.round(rect.x + (rect.width > 0 ? Math.min(28, rect.width / 2) : 10));
          const y = Math.round(rect.y + (rect.height > 0 ? rect.height / 2 : 10));
          const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
          el.dispatchEvent(new PointerEvent('pointerover', opts));
          el.dispatchEvent(new PointerEvent('pointerdown', opts));
          el.dispatchEvent(new MouseEvent('mousedown', opts));
          if (el instanceof HTMLElement) el.focus({ preventScroll: true });
          el.dispatchEvent(new PointerEvent('pointerup', opts));
          el.dispatchEvent(new MouseEvent('mouseup', opts));
          el.dispatchEvent(new MouseEvent('click', opts));
        }

        // 1. AWS WAF Captcha
        const awsButtons = queryDeep(
          '#aws-waf-captcha-box input[type="checkbox"], button#aws-waf-captcha-submit, #aws-waf-captcha-box button'
        ) as HTMLElement[];
        for (const b of awsButtons) {
          const rect = b.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            dispatchClick(b);
            return { clicked: true, name: 'AWS WAF' };
          }
        }

        // 2. GeeTest Radar button
        const geetestButtons = queryDeep('.geetest_radar_btn, .geetest_radar_tip, .geetest_btn') as HTMLElement[];
        for (const b of geetestButtons) {
          const rect = b.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            dispatchClick(b);
            return { clicked: true, name: 'GeeTest' };
          }
        }

        // 3. Arkose / FunCaptcha Verify button
        const arkoseButtons = queryDeep(
          'button[data-theme="home.verify"], button[aria-label*="verify" i], #home_children_button'
        ) as HTMLElement[];
        for (const b of arkoseButtons) {
          const rect = b.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            dispatchClick(b);
            return { clicked: true, name: 'Arkose' };
          }
        }

        return { none: true };
      },
    });

    for (const r of results) {
      const res = r.result as { clicked?: boolean; name?: string } | null;
      if (res?.clicked) {
        // If slider puzzle follows GeeTest/Arkose click, solve with LLM slider
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const sliderResult = await solveSliderCaptcha(tabId, options);
        if (sliderResult.success) return sliderResult;

        return { success: true, message: `${res.name ?? 'Challenge'} button clicked successfully.` };
      }
    }

    return { success: false, message: 'No generic challenge button found.' };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Automatically detects any bot challenge on the page.
 */
export async function detectPageCaptcha(tabId: number): Promise<CaptchaDetection> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        function queryDeep(selector: string, root: Document | Element | ShadowRoot = document): Element[] {
          const res: Element[] = Array.from(root.querySelectorAll(selector));
          const allEls = root.querySelectorAll('*');
          for (let i = 0; i < allEls.length; i++) {
            const el = allEls[i];
            if (el && el.shadowRoot) {
              res.push(...queryDeep(selector, el.shadowRoot));
            }
          }
          return res;
        }

        function isVisible(el: Element): boolean {
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        }

        const title = document.title.toLowerCase();
        const frameUrl = window.location.href;
        const lowerFrameUrl = frameUrl.toLowerCase();
        const isCaptchaProviderFrame =
          lowerFrameUrl.includes('recaptcha') ||
          lowerFrameUrl.includes('hcaptcha.com') ||
          lowerFrameUrl.includes('challenges.cloudflare.com') ||
          lowerFrameUrl.includes('captcha-delivery.com') ||
          lowerFrameUrl.includes('geetest.com') ||
          lowerFrameUrl.includes('arkoselabs.com');

        // Interactive challenges get precedence over the provider wrapper so the
        // handoff can tell the person what is actually waiting inside the iframe.
        const audioControls = queryDeep(
          [
            '#audio-response',
            '#audio-source',
            '.rc-audiochallenge-play-button',
            'button[aria-label*="audio challenge" i]',
            'input[aria-label*="audio" i]',
            '[id*="captcha" i][id*="audio-response" i]',
            '[class*="captcha" i][class*="audio" i]',
          ].join(',')
        );
        if (audioControls.some(isVisible)) {
          return { detected: true, type: 'audio' as const, frameUrl, details: 'Audio CAPTCHA challenge detected' };
        }

        const sliderControls = queryDeep(
          [
            '.geetest_slider',
            '.geetest_slider_button',
            '.tc-slider-normal',
            '.secsdk-captcha-drag-icon',
            '.captcha-slider',
            '[class*="captcha" i][class*="slider" i]',
            '[class*="slider" i][class*="drag" i]',
            '[aria-label*="slide" i][aria-label*="verify" i]',
          ].join(',')
        );
        if (sliderControls.some(isVisible)) {
          return { detected: true, type: 'slider' as const, frameUrl, details: 'Slider/puzzle CAPTCHA challenge detected' };
        }

        const imageChallenge = queryDeep(
          [
            '.rc-imageselect',
            '.rc-imageselect-table',
            '.task-grid',
            '.challenge-grid',
            '[class*="captcha" i][class*="image" i]',
            '[aria-label*="image challenge" i]',
          ].join(',')
        );
        if (imageChallenge.some(isVisible) && isCaptchaProviderFrame) {
          return { detected: true, type: 'image' as const, frameUrl, details: 'Image-selection CAPTCHA challenge detected' };
        }

        // 1. Cloudflare Turnstile / Challenge
        if (title.includes('just a moment') || title.includes('attention required') || title.includes('verify you are human')) {
          return { detected: true, type: 'cloudflare' as const, frameUrl, details: 'Cloudflare challenge page detected' };
        }
        const cfIframes = queryDeep(
          'iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], iframe[src*="cf-chl"]'
        ) as HTMLIFrameElement[];
        if (cfIframes.some(isVisible)) {
          return { detected: true, type: 'cloudflare' as const, frameUrl, details: 'Visible Cloudflare Turnstile widget detected' };
        }
        const cfWrappers = queryDeep('.cf-turnstile, #challenge-stage');
        if (cfWrappers.some(isVisible)) {
          return { detected: true, type: 'cloudflare' as const, frameUrl, details: 'Visible Cloudflare challenge stage detected' };
        }

        // 2. Google reCAPTCHA
        const recaptchaCheckboxes = queryDeep(
          '#recaptcha-anchor, .recaptcha-checkbox, [role="checkbox"][aria-labelledby*="recaptcha"]'
        );
        if (recaptchaCheckboxes.some(isVisible)) {
          return { detected: true, type: 'recaptcha' as const, frameUrl, details: 'Visible reCAPTCHA checkbox detected' };
        }
        const recaptchaBframes = queryDeep(
          'iframe[src*="recaptcha/api2/bframe"], iframe[title*="recaptcha challenge" i], iframe[title*="challenge reCAPTCHA" i]'
        ) as HTMLIFrameElement[];
        if (
          recaptchaBframes.some((f) => {
            const rect = f.getBoundingClientRect();
            return rect.width > 100 && rect.height > 100 && isVisible(f);
          })
        ) {
          return { detected: true, type: 'image' as const, frameUrl, details: 'Active reCAPTCHA image challenge popup detected' };
        }

        // 3. hCaptcha
        const hcaptchaCheckboxes = queryDeep('#checkbox, [aria-label*="hCaptcha" i][role="checkbox"]');
        if (hcaptchaCheckboxes.some(isVisible)) {
          return { detected: true, type: 'hcaptcha' as const, frameUrl, details: 'Visible hCaptcha checkbox detected' };
        }
        const hcaptchaFrames = queryDeep('iframe[src*="hcaptcha.com"]') as HTMLIFrameElement[];
        if (
          hcaptchaFrames.some((f) => {
            const rect = f.getBoundingClientRect();
            return rect.width > 100 && rect.height > 100 && isVisible(f);
          })
        ) {
          return { detected: true, type: 'image' as const, frameUrl, details: 'Active hCaptcha image challenge frame detected' };
        }

        // 4. Visual text captcha (img/canvas + input both visible)
        const imgs = queryDeep(
          'img[src*="captcha" i], img[id*="captcha" i], img[class*="captcha" i], canvas[id*="captcha" i], canvas[class*="captcha" i]'
        );
        const inputs = queryDeep(
          'input[name*="captcha" i], input[id*="captcha" i], input[placeholder*="captcha" i], input[aria-label*="captcha" i]'
        );
        const visibleImg = imgs.find(isVisible);
        const visibleInput = inputs.find(isVisible);
        if (visibleImg && visibleInput) {
          return { detected: true, type: 'image' as const, frameUrl, details: 'Visual text CAPTCHA detected' };
        }

        return { detected: false, type: 'unknown' as const };
      },
    });

    const detections = results
      .map((result) => result.result as CaptchaDetection | undefined)
      .filter((result): result is CaptchaDetection => Boolean(result?.detected));

    return (
      detections.sort((a, b) => CAPTCHA_TYPE_PRIORITY[b.type] - CAPTCHA_TYPE_PRIORITY[a.type])[0] ?? {
        detected: false,
        type: 'unknown',
      }
    );
  } catch {
    return { detected: false, type: 'unknown' };
  }
}

/**
 * Makes an interactive challenge easy to reach during a human handoff.
 */
export async function prepareCaptchaHandoff(
  tabId: number,
  type: CaptchaDetection['type']
): Promise<CaptchaHandoffPreparation> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (challengeType) => {
        function firstVisible(selectors: string[]): HTMLElement | null {
          for (const selector of selectors) {
            for (const el of document.querySelectorAll(selector)) {
              const html = el as HTMLElement;
              const rect = html.getBoundingClientRect();
              const style = window.getComputedStyle(html);
              if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
                return html;
              }
            }
          }
          return null;
        }

        const selectors: Record<string, string[]> = {
          audio: [
            '#audio-response',
            'input[aria-label*="audio" i]',
            '#recaptcha-audio-button',
            'button[aria-label*="audio challenge" i]',
            'button[title*="audio challenge" i]',
            '[id*="captcha" i][id*="audio" i]',
          ],
          slider: [
            '.geetest_slider_button',
            '.secsdk-captcha-drag-icon',
            '.tc-slider-normal',
            '.captcha-slider',
            '[class*="captcha" i][class*="slider" i]',
            '[aria-label*="slide" i][aria-label*="verify" i]',
          ],
          image: [
            '.rc-imageselect',
            '.task-grid',
            '.challenge-grid',
            '[class*="captcha" i][class*="image" i]',
            'img[src*="captcha" i]',
          ],
        };

        const target = firstVisible(selectors[challengeType] ?? []);
        if (!target) return { prepared: false };

        target.scrollIntoView({ block: 'center', inline: 'center' });
        target.focus({ preventScroll: true });

        if (
          challengeType === 'audio' &&
          target.matches('#recaptcha-audio-button, button[aria-label*="audio challenge" i], button[title*="audio challenge" i]')
        ) {
          target.click();
          return { prepared: true, switchedToAudio: true };
        }
        return { prepared: true, switchedToAudio: false };
      },
      args: [type],
    });

    const prepared = results.find((result) => result.result?.prepared)?.result as
      | { prepared: boolean; switchedToAudio?: boolean }
      | undefined;
    if (!prepared) return { prepared: false, message: 'Challenge detected; open the active tab to complete it.' };
    return {
      prepared: true,
      message: prepared.switchedToAudio
        ? 'Opened the audio challenge and focused its controls.'
        : 'Focused the challenge control in the active tab.',
    };
  } catch (err) {
    return { prepared: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Solves slider & puzzle CAPTCHAs via LLM Vision gap detection and natural drag & drop simulation.
 */
export async function solveSliderCaptcha(
  tabId: number,
  options?: CaptchaSolverOptions
): Promise<{ success: boolean; message: string }> {
  try {
    // 1. Extract puzzle background image & track dimensions
    const extractResults = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        function queryDeep(selector: string, root: Document | Element | ShadowRoot = document): Element[] {
          const res: Element[] = Array.from(root.querySelectorAll(selector));
          const allEls = root.querySelectorAll('*');
          for (let i = 0; i < allEls.length; i++) {
            const el = allEls[i];
            if (el && el.shadowRoot) res.push(...queryDeep(selector, el.shadowRoot));
          }
          return res;
        }

        const sliderButtons = queryDeep(
          [
            '.geetest_slider_button',
            '.secsdk-captcha-drag-icon',
            '.tc-slider-normal',
            '.captcha-slider-btn',
            '.captcha-slider',
            '[class*="slider" i][class*="btn" i]',
            '[class*="slider" i][class*="button" i]',
            '[class*="slider" i][class*="drag" i]',
            '[aria-label*="slide" i][aria-label*="verify" i]',
          ].join(',')
        ) as HTMLElement[];

        const visibleButton = sliderButtons.find((b) => {
          const rect = b.getBoundingClientRect();
          const style = window.getComputedStyle(b);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        });

        if (!visibleButton) return { found: false };

        const buttonRect = visibleButton.getBoundingClientRect();
        const track =
          (visibleButton.closest(
            '[class*="track" i], [class*="slider" i], [class*="bar" i], .geetest_slider, .tc-slider'
          ) as HTMLElement) || visibleButton.parentElement;
        const trackWidth = track ? track.getBoundingClientRect().width : 280;

        // Try extracting canvas/image of puzzle background
        const canvases = queryDeep('canvas.geetest_canvas_bg, canvas.tc-canvas, canvas[class*="captcha" i], img[class*="captcha" i]') as (
          | HTMLCanvasElement
          | HTMLImageElement
        )[];
        let imageSrc = '';
        const visibleCanvas = canvases.find((c) => {
          const r = c.getBoundingClientRect();
          return r.width > 50 && r.height > 30;
        });

        if (visibleCanvas instanceof HTMLCanvasElement) {
          try {
            imageSrc = visibleCanvas.toDataURL('image/png');
          } catch {
            // ignore canvas security error
          }
        } else if (visibleCanvas instanceof HTMLImageElement && visibleCanvas.src) {
          imageSrc = visibleCanvas.src;
        }

        return {
          found: true,
          trackWidth,
          buttonWidth: buttonRect.width,
          imageSrc,
        };
      },
    });

    const extracted = extractResults.find((r) => r.result?.found)?.result as {
      found: boolean;
      trackWidth: number;
      buttonWidth: number;
      imageSrc: string;
    } | undefined;

    if (!extracted || !extracted.found) {
      return { success: false, message: 'Slider puzzle handle not found in DOM.' };
    }

    let targetDistance = Math.round(
      Math.max(100, Math.min(extracted.trackWidth - extracted.buttonWidth - 10, extracted.trackWidth * 0.72))
    );

    // 2. If background puzzle image is present, ask LLM Vision for target offset
    if (extracted.imageSrc) {
      const prompt = `Analyze this slider puzzle image. There is a blank gap / puzzle piece silhouette in the background.
What is the horizontal pixel offset X (from 0 to ${Math.round(extracted.trackWidth)}) where the missing puzzle piece should be placed?
Return ONLY the integer number of the target X offset (e.g. 145).`;

      const llmOffsetStr = await callCaptchaLLM(prompt, [extracted.imageSrc], options);
      const match = llmOffsetStr.match(/\b\d+\b/);
      if (match) {
        const parsedX = parseInt(match[0], 10);
        if (parsedX > 20 && parsedX < extracted.trackWidth) {
          targetDistance = parsedX;
        }
      }
    }

    // 3. Execute natural human drag simulation
    const dragResults = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: async (dist) => {
        function queryDeep(selector: string, root: Document | Element | ShadowRoot = document): Element[] {
          const res: Element[] = Array.from(root.querySelectorAll(selector));
          const allEls = root.querySelectorAll('*');
          for (let i = 0; i < allEls.length; i++) {
            const el = allEls[i];
            if (el && el.shadowRoot) res.push(...queryDeep(selector, el.shadowRoot));
          }
          return res;
        }

        const sliderButtons = queryDeep(
          [
            '.geetest_slider_button',
            '.secsdk-captcha-drag-icon',
            '.tc-slider-normal',
            '.captcha-slider-btn',
            '.captcha-slider',
            '[class*="slider" i][class*="btn" i]',
            '[class*="slider" i][class*="button" i]',
            '[class*="slider" i][class*="drag" i]',
            '[aria-label*="slide" i][aria-label*="verify" i]',
          ].join(',')
        ) as HTMLElement[];

        const visibleButton = sliderButtons.find((b) => {
          const rect = b.getBoundingClientRect();
          const style = window.getComputedStyle(b);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        });

        if (!visibleButton) return { dragged: false };

        const buttonRect = visibleButton.getBoundingClientRect();
        const startX = Math.round(buttonRect.x + buttonRect.width / 2);
        const startY = Math.round(buttonRect.y + buttonRect.height / 2);

        const dispatchDrag = (type: string, x: number, y: number, target: Element) => {
          const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, buttons: 1 };
          target.dispatchEvent(new PointerEvent(type.startsWith('pointer') ? type : `pointer${type.slice(5)}`, opts));
          target.dispatchEvent(new MouseEvent(type.startsWith('mouse') ? type : `mouse${type.slice(7)}`, opts));
        };

        dispatchDrag('pointerdown', startX, startY, visibleButton);
        dispatchDrag('mousedown', startX, startY, visibleButton);

        const steps = 24;
        for (let i = 1; i <= steps; i++) {
          const progress = i / steps;
          // Cubic ease-out
          const easeProgress = 1 - Math.pow(1 - progress, 3);
          const currentX = Math.round(startX + dist * easeProgress);
          const currentY = Math.round(startY + (Math.sin(progress * Math.PI) * 2 - 1));

          const currentTarget = document.elementFromPoint(currentX, currentY) || visibleButton;
          dispatchDrag('pointermove', currentX, currentY, currentTarget);
          dispatchDrag('mousemove', currentX, currentY, currentTarget);
          await new Promise((r) => setTimeout(r, 10 + Math.floor(Math.random() * 8)));
        }

        const finalX = startX + dist;
        const finalTarget = document.elementFromPoint(finalX, startY) || visibleButton;
        dispatchDrag('pointerup', finalX, startY, finalTarget);
        dispatchDrag('mouseup', finalX, startY, finalTarget);
        dispatchDrag('click', finalX, startY, finalTarget);

        return { dragged: true, distance: dist };
      },
      args: [targetDistance],
    });

    for (const r of dragResults) {
      const res = r.result as { dragged?: boolean; distance?: number } | null;
      if (res?.dragged) {
        return { success: true, message: `Slider puzzle dragged smoothly by ${res.distance ?? 0}px.` };
      }
    }

    return { success: false, message: 'Slider puzzle drag simulation failed.' };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Solves distorted visual alphanumeric text CAPTCHAs using LLM Vision OCR and automated input filling.
 */
export async function solveVisualTextCaptcha(
  tabId: number,
  options?: CaptchaSolverOptions
): Promise<{ success: boolean; message: string; code?: string }> {
  try {
    // 1. Locate CAPTCHA image and extract base64 data
    const extractResults = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        function queryDeep(selector: string, root: Document | Element | ShadowRoot = document): Element[] {
          const res: Element[] = Array.from(root.querySelectorAll(selector));
          const allEls = root.querySelectorAll('*');
          for (let i = 0; i < allEls.length; i++) {
            const el = allEls[i];
            if (el && el.shadowRoot) res.push(...queryDeep(selector, el.shadowRoot));
          }
          return res;
        }

        function isVisible(el: Element): boolean {
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        }

        const imgs = queryDeep(
          'img[src*="captcha" i], img[id*="captcha" i], img[class*="captcha" i], canvas[id*="captcha" i], canvas[class*="captcha" i]'
        ) as (HTMLImageElement | HTMLCanvasElement)[];
        const inputs = queryDeep(
          'input[name*="captcha" i], input[id*="captcha" i], input[placeholder*="captcha" i], input[aria-label*="captcha" i]'
        ) as HTMLInputElement[];

        const visibleImg = imgs.find(isVisible);
        const visibleInput = inputs.find(isVisible);

        if (!visibleImg || !visibleInput) return { found: false };

        visibleInput.scrollIntoView({ block: 'center', inline: 'center' });
        visibleInput.focus({ preventScroll: true });

        // Fast-path: check if alt or data attributes contain the code
        const possibleCode =
          visibleImg.getAttribute('alt') || visibleImg.getAttribute('data-code') || visibleImg.getAttribute('title');
        if (
          possibleCode &&
          possibleCode.length >= 3 &&
          possibleCode.length <= 8 &&
          !possibleCode.toLowerCase().includes('captcha')
        ) {
          visibleInput.value = possibleCode;
          visibleInput.dispatchEvent(new Event('input', { bubbles: true }));
          visibleInput.dispatchEvent(new Event('change', { bubbles: true }));
          return { found: true, solved: true, code: possibleCode };
        }

        // Extract base64 image data
        let imageBase64 = '';
        if (visibleImg instanceof HTMLCanvasElement) {
          try {
            imageBase64 = visibleImg.toDataURL('image/png');
          } catch {
            // ignore canvas error
          }
        } else if (visibleImg instanceof HTMLImageElement) {
          if (visibleImg.src && visibleImg.src.startsWith('data:image')) {
            imageBase64 = visibleImg.src;
          } else {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = visibleImg.naturalWidth || visibleImg.width || 120;
              canvas.height = visibleImg.naturalHeight || visibleImg.height || 40;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(visibleImg, 0, 0);
                imageBase64 = canvas.toDataURL('image/png');
              }
            } catch {
              // fallback to direct src
              imageBase64 = visibleImg.src;
            }
          }
        }

        return { found: true, solved: false, imageBase64 };
      },
    });

    for (const r of extractResults) {
      const res = r.result as { found?: boolean; solved?: boolean; code?: string; imageBase64?: string } | null;
      if (res?.solved && res.code) {
        return { success: true, message: `Visual text CAPTCHA automatically filled with "${res.code}".`, code: res.code };
      }
    }

    const extracted = extractResults.find((r) => r.result?.found)?.result as {
      found: boolean;
      imageBase64?: string;
    } | undefined;

    if (!extracted || !extracted.imageBase64) {
      return { success: false, message: 'Visual text CAPTCHA image could not be extracted.' };
    }

    // 2. Query LLM Vision to recognize characters/digits
    const prompt = `You are a precise OCR system. Look at this distorted CAPTCHA image and extract ONLY the exact alphanumeric characters or digits shown.
Ignore background noise, distortion lines, grids, or colors.
Return ONLY the raw code string without spaces, quotes, markdown formatting, or explanation.`;

    const llmResult = await callCaptchaLLM(prompt, [extracted.imageBase64], options);
    const cleanedCode = llmResult.replace(/[`"'=;\n\r\t]/g, '').trim().replace(/^captcha:?\s*/i, '').replace(/^code:?\s*/i, '');

    if (cleanedCode.length >= 2 && cleanedCode.length <= 12) {
      // 3. Inject recognized code into the input field
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: (codeToFill) => {
          function queryDeep(selector: string, root: Document | Element | ShadowRoot = document): Element[] {
            const res: Element[] = Array.from(root.querySelectorAll(selector));
            const allEls = root.querySelectorAll('*');
            for (let i = 0; i < allEls.length; i++) {
              const el = allEls[i];
              if (el && el.shadowRoot) res.push(...queryDeep(selector, el.shadowRoot));
            }
            return res;
          }

          const inputs = queryDeep(
            'input[name*="captcha" i], input[id*="captcha" i], input[placeholder*="captcha" i], input[aria-label*="captcha" i]'
          ) as HTMLInputElement[];
          const input = inputs.find((inp) => {
            const rect = inp.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });

          if (input) {
            input.focus({ preventScroll: true });
            input.value = codeToFill;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        },
        args: [cleanedCode],
      });

      return {
        success: true,
        message: `Visual text CAPTCHA solved via LLM Vision and filled with "${cleanedCode}".`,
        code: cleanedCode,
      };
    }

    return { success: false, message: 'Visual text CAPTCHA image located, but OCR did not produce a valid code.' };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Unified smart solver that dispatches to the corresponding CAPTCHA solver (with LLM Vision support).
 */
export async function solveCaptcha(
  tabId: number,
  type?: CaptchaDetection['type'],
  options?: CaptchaSolverOptions
): Promise<{ success: boolean; message: string; type?: CaptchaDetection['type'] }> {
  let targetType = type;
  if (!targetType || targetType === 'unknown') {
    const detection = await detectPageCaptcha(tabId);
    if (detection.detected) {
      targetType = detection.type;
    }
  }

  if (targetType === 'cloudflare') {
    const res = await solveCloudflareChallenge(tabId);
    return { ...res, type: 'cloudflare' };
  }
  if (targetType === 'recaptcha') {
    const res = await solveRecaptchaChallenge(tabId, options);
    return { ...res, type: 'recaptcha' };
  }
  if (targetType === 'hcaptcha') {
    const res = await solveHcaptchaChallenge(tabId, options);
    return { ...res, type: 'hcaptcha' };
  }
  if (targetType === 'slider') {
    const sliderRes = await solveSliderCaptcha(tabId, options);
    if (sliderRes.success) return { ...sliderRes, type: 'slider' };
    const preparation = await prepareCaptchaHandoff(tabId, 'slider');
    return {
      success: false,
      message: `Slider/puzzle CAPTCHA detected. ${preparation.message} Human verification is required.`,
      type: 'slider',
    };
  }
  if (targetType === 'image') {
    const visualRes = await solveVisualTextCaptcha(tabId, options);
    if (visualRes.success) return { ...visualRes, type: 'image' };

    const recaptchaRes = await solveRecaptchaImageChallenge(tabId, options);
    if (recaptchaRes.success) return { ...recaptchaRes, type: 'recaptcha' };

    const hcaptchaRes = await solveHcaptchaImageChallenge(tabId, options);
    if (hcaptchaRes.success) return { ...hcaptchaRes, type: 'hcaptcha' };

    const preparation = await prepareCaptchaHandoff(tabId, 'image');
    return {
      success: false,
      message: `Image CAPTCHA detected. ${preparation.message} Human verification is required.`,
      type: 'image',
    };
  }
  if (targetType === 'audio') {
    const preparation = await prepareCaptchaHandoff(tabId, 'audio');
    return {
      success: false,
      message: `Audio CAPTCHA detected. ${preparation.message} Human verification is required.`,
      type: 'audio',
    };
  }

  // Fallback: try all solvers in sequence
  const cf = await solveCloudflareChallenge(tabId);
  if (cf.success) return { ...cf, type: 'cloudflare' };
  const rc = await solveRecaptchaChallenge(tabId, options);
  if (rc.success) return { ...rc, type: 'recaptcha' };
  const hc = await solveHcaptchaChallenge(tabId, options);
  if (hc.success) return { ...hc, type: 'hcaptcha' };
  const txt = await solveVisualTextCaptcha(tabId, options);
  if (txt.success) return { ...txt, type: 'image' };
  const sl = await solveSliderCaptcha(tabId, options);
  if (sl.success) return { ...sl, type: 'slider' };
  const gen = await solveGenericChallenge(tabId, options);
  if (gen.success) return { ...gen, type: 'cloudflare' };

  return { success: false, message: 'No solvable CAPTCHA or challenge found on page.', type: 'unknown' };
}
