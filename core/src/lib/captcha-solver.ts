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
    lowerUrl.includes('challenges.cloudflare') ||
    lowerUrl.includes('/cdn-cgi/challenge') ||
    lowerSnippet.includes('cf-turnstile') ||
    lowerSnippet.includes('cf-challenge') ||
    lowerSnippet.includes('challenges.cloudflare.com') ||
    lowerSnippet.includes('challenges.cloudflare')
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
        // 1. Search for Cloudflare Turnstile iframe
        const iframes = Array.from(document.querySelectorAll('iframe'));
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
        const wrappers = document.querySelectorAll('.cf-turnstile, #challenge-stage, [data-sitekey]');
        for (const w of Array.from(wrappers)) {
          const rect = w.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return { foundWrapper: true, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
          }
        }

        // 3. Search for checkbox inside current frame
        const cb = document.querySelector('input[type="checkbox"], .ctp-checkbox-label, .ctp-checkbox-container') as HTMLElement | null;
        if (cb) {
          cb.click();
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
 * Automatically detects any bot challenge on the page.
 */
export async function detectPageCaptcha(tabId: number): Promise<CaptchaDetection> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const title = document.title;
        const html = document.documentElement.innerHTML.toLowerCase();

        if (html.includes('challenges.cloudflare.com') || html.includes('cf-turnstile') || title.toLowerCase().includes('just a moment')) {
          return { detected: true, type: 'cloudflare' as const, details: 'Cloudflare Turnstile / Challenge detected' };
        }
        if (html.includes('recaptcha') || document.querySelector('.g-recaptcha, iframe[src*="recaptcha"]')) {
          return { detected: true, type: 'recaptcha' as const, details: 'Google reCAPTCHA detected' };
        }
        if (html.includes('hcaptcha') || document.querySelector('.h-captcha, iframe[src*="hcaptcha"]')) {
          return { detected: true, type: 'hcaptcha' as const, details: 'hCaptcha detected' };
        }
        const img = document.querySelector('img[src*="captcha"], img[id*="captcha"], img[class*="captcha"]');
        const input = document.querySelector('input[name*="captcha"], input[id*="captcha"], input[placeholder*="captcha" i]');
        if (img && input) {
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
