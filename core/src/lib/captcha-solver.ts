/**
 * Automated CAPTCHA & Cloudflare Turnstile Solver for WebOperator.
 * Handles Cloudflare Turnstile, reCAPTCHA/hCaptcha checkboxes, and visual text CAPTCHAs.
 */

export interface CaptchaDetection {
  detected: boolean;
  type: 'cloudflare' | 'recaptcha' | 'hcaptcha' | 'image' | 'unknown';
  frameUrl?: string;
  details?: string;
  imageRef?: string;
  inputRef?: string;
}

/**
 * Checks if the page is currently displaying a Cloudflare or Bot Challenge.
 */
export function isBotChallengePage(title: string, url: string, bodySnippet = ''): boolean {
  const lowerTitle = title.toLowerCase();
  const lowerUrl = url.toLowerCase();
  const lowerSnippet = bodySnippet.toLowerCase();

  return (
    lowerTitle.includes('just a moment') ||
    lowerTitle.includes('attention required') ||
    lowerTitle.includes('security check') ||
    lowerTitle.includes('verify you are human') ||
    lowerTitle.includes('checking your browser') ||
    lowerTitle.includes('cloudflare') ||
    lowerTitle.includes('recaptcha') ||
    lowerTitle.includes('hcaptcha') ||
    lowerTitle.includes('bot challenge') ||
    lowerTitle.includes('bot detection') ||
    lowerUrl.includes('challenges.cloudflare') ||
    lowerUrl.includes('/cdn-cgi/challenge') ||
    lowerUrl.includes('recaptcha') ||
    lowerUrl.includes('hcaptcha') ||
    lowerSnippet.includes('cf-turnstile') ||
    lowerSnippet.includes('cf-challenge') ||
    lowerSnippet.includes('challenges.cloudflare.com') ||
    lowerSnippet.includes('challenges.cloudflare') ||
    lowerSnippet.includes('g-recaptcha') ||
    lowerSnippet.includes('h-captcha') ||
    lowerSnippet.includes('recaptcha')
  );
}

/**
 * Injects a script into the tab to detect and solve Cloudflare Turnstile & Checkbox CAPTCHAs.
 */
export async function solveCloudflareChallenge(tabId: number): Promise<{ success: boolean; message: string }> {
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

        // 1. Search for Cloudflare Turnstile iframe
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

        // 2. Search for shadow root / turnstile wrappers
        const wrappers = queryDeep('.cf-turnstile, #challenge-stage, [data-sitekey]');
        for (const w of wrappers) {
          const rect = w.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return { foundWrapper: true, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
          }
        }

        // 3. Search for checkbox inside current frame / shadow roots
        const checkboxes = queryDeep('input[type="checkbox"], .ctp-checkbox-label, .ctp-checkbox-container') as HTMLElement[];
        if (checkboxes.length > 0 && checkboxes[0]) {
          checkboxes[0].click();
          return { clickedCheckbox: true };
        }

        return { none: true };
      },
    });

    // Check if any frame clicked or found the challenge
    for (const r of results) {
      const res = r.result as Record<string, unknown> | null;
      if (res?.clickedCheckbox) {
        return { success: true, message: 'Cloudflare checkbox clicked successfully.' };
      }
    }

    // Try finding by coordinate click on the primary challenge container
    for (const r of results) {
      const res = r.result as { foundIframe?: boolean; foundWrapper?: boolean; rect?: { x: number; y: number; w: number; h: number } } | null;
      if (res?.rect) {
        const clickX = Math.round(res.rect.x + Math.min(30, res.rect.w / 2));
        const clickY = Math.round(res.rect.y + res.rect.h / 2);

        await chrome.scripting.executeScript({
          target: { tabId },
          func: (x, y) => {
            const el = document.elementFromPoint(x, y);
            if (el) {
              const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
              el.dispatchEvent(new MouseEvent('mousedown', opts));
              el.dispatchEvent(new MouseEvent('mouseup', opts));
              el.dispatchEvent(new MouseEvent('click', opts));
            }
          },
          args: [clickX, clickY],
        });

        return { success: true, message: `Cloudflare challenge clicked at (${clickX}, ${clickY}).` };
      }
    }

    return { success: false, message: 'Cloudflare challenge element not found in DOM.' };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Injects a script into the tab to detect and click Google reCAPTCHA v2 / Enterprise checkbox.
 */
export async function solveRecaptchaChallenge(tabId: number): Promise<{ success: boolean; message: string }> {
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

        // Look for checkbox inside frame / shadow root
        const checkboxes = queryDeep('#recaptcha-anchor, .recaptcha-checkbox, [role="checkbox"][aria-labelledby*="recaptcha"]') as HTMLElement[];
        if (checkboxes.length > 0 && checkboxes[0]) {
          checkboxes[0].click();
          return { clickedCheckbox: true };
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
      const res = r.result as Record<string, unknown> | null;
      if (res?.clickedCheckbox) {
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
              el.dispatchEvent(new MouseEvent('mousedown', opts));
              el.dispatchEvent(new MouseEvent('mouseup', opts));
              el.dispatchEvent(new MouseEvent('click', opts));
            }
          },
          args: [clickX, clickY],
        });

        return { success: true, message: `reCAPTCHA checkbox clicked at (${clickX}, ${clickY}).` };
      }
    }

    return { success: false, message: 'reCAPTCHA checkbox element not found in DOM.' };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Injects a script into the tab to detect and click hCaptcha checkbox.
 */
export async function solveHcaptchaChallenge(tabId: number): Promise<{ success: boolean; message: string }> {
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

        // Look for checkbox inside hCaptcha frame / shadow root
        const checkboxes = queryDeep('#checkbox, [aria-label*="hCaptcha"][role="checkbox"]') as HTMLElement[];
        if (checkboxes.length > 0 && checkboxes[0]) {
          checkboxes[0].click();
          return { clickedCheckbox: true };
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
      const res = r.result as Record<string, unknown> | null;
      if (res?.clickedCheckbox) {
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
              el.dispatchEvent(new MouseEvent('mousedown', opts));
              el.dispatchEvent(new MouseEvent('mouseup', opts));
              el.dispatchEvent(new MouseEvent('click', opts));
            }
          },
          args: [clickX, clickY],
        });

        return { success: true, message: `hCaptcha checkbox clicked at (${clickX}, ${clickY}).` };
      }
    }

    return { success: false, message: 'hCaptcha element not found in DOM.' };
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
      target: { tabId },
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

        const title = document.title;
        const html = document.documentElement.innerHTML.toLowerCase();

        if (html.includes('challenges.cloudflare.com') || html.includes('cf-turnstile') || title.toLowerCase().includes('just a moment')) {
          return { detected: true, type: 'cloudflare' as const, details: 'Cloudflare Turnstile / Challenge detected' };
        }
        if (html.includes('recaptcha') || queryDeep('.g-recaptcha, iframe[src*="recaptcha"]').length > 0) {
          return { detected: true, type: 'recaptcha' as const, details: 'Google reCAPTCHA detected' };
        }
        if (html.includes('hcaptcha') || queryDeep('.h-captcha, iframe[src*="hcaptcha"]').length > 0) {
          return { detected: true, type: 'hcaptcha' as const, details: 'hCaptcha detected' };
        }
        const imgs = queryDeep('img[src*="captcha"], img[id*="captcha"], img[class*="captcha"]');
        const inputs = queryDeep('input[name*="captcha"], input[id*="captcha"], input[placeholder*="captcha" i]');
        if (imgs.length > 0 && inputs.length > 0) {
          return { detected: true, type: 'image' as const, details: 'Visual Text CAPTCHA detected' };
        }

        return { detected: false, type: 'unknown' as const };
      },
    });

    return (results[0]?.result as CaptchaDetection) ?? { detected: false, type: 'unknown' };
  } catch {
    return { detected: false, type: 'unknown' };
  }
}

/**
 * Unified solver that detects or dispatches to the corresponding CAPTCHA solver.
 */
export async function solveCaptcha(
  tabId: number,
  type?: CaptchaDetection['type']
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
    const res = await solveRecaptchaChallenge(tabId);
    return { ...res, type: 'recaptcha' };
  }
  if (targetType === 'hcaptcha') {
    const res = await solveHcaptchaChallenge(tabId);
    return { ...res, type: 'hcaptcha' };
  }
  if (targetType === 'image') {
    return { success: false, message: 'Visual text CAPTCHA detected. Requires manual entry or human verification.', type: 'image' };
  }

  // Fallback: try all solvers in sequence
  const cf = await solveCloudflareChallenge(tabId);
  if (cf.success) return { ...cf, type: 'cloudflare' };
  const rc = await solveRecaptchaChallenge(tabId);
  if (rc.success) return { ...rc, type: 'recaptcha' };
  const hc = await solveHcaptchaChallenge(tabId);
  if (hc.success) return { ...hc, type: 'hcaptcha' };

  return { success: false, message: 'No solvable CAPTCHA or challenge found on page.', type: 'unknown' };
}

