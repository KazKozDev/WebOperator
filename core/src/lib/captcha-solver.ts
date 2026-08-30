/**
 * CAPTCHA detection and verification handoff for WebOperator.
 * Existing checkbox helpers remain separate from image, slider, and audio handoffs.
 */

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
    lowerTitle.includes('checking your browser') ||
    lowerTitle.includes('cloudflare bot challenge');

  const isChallengeUrl =
    lowerUrl.includes('challenges.cloudflare.com') ||
    lowerUrl.includes('/cdn-cgi/challenge') ||
    lowerUrl.includes('waf.datadome.co') ||
    lowerUrl.includes('geo.captcha-delivery.com');

  const isChallengeSnippet =
    lowerSnippet.includes('cf-challenge') ||
    lowerSnippet.includes('challenges.cloudflare.com/turnstile');

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
          const checkboxes = queryDeep('input[type="checkbox"], .ctp-checkbox-label, .ctp-checkbox-container, #challenge-stage input') as HTMLElement[];
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
 * Injects a script into the tab to detect and click Google reCAPTCHA v2 / Enterprise checkbox.
 */
export async function solveRecaptchaChallenge(tabId: number): Promise<{ success: boolean; message: string }> {
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

          // Look for checkbox inside frame / shadow root
          const checkboxes = queryDeep('#recaptcha-anchor, .recaptcha-checkbox, .recaptcha-checkbox-border, [role="checkbox"][aria-labelledby*="recaptcha"]') as HTMLElement[];
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
 * Injects a script into the tab to detect and click hCaptcha checkbox.
 */
export async function solveHcaptchaChallenge(tabId: number): Promise<{ success: boolean; message: string }> {
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
 * Injects a script into the tab to detect and click AWS WAF / DataDome / GeeTest checkboxes.
 */
export async function solveGenericChallenge(tabId: number): Promise<{ success: boolean; message: string }> {
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
        const awsButtons = queryDeep('#aws-waf-captcha-box input[type="checkbox"], button#aws-waf-captcha-submit, #aws-waf-captcha-box button') as HTMLElement[];
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
        const arkoseButtons = queryDeep('button[data-theme="home.verify"], button[aria-label*="verify" i], #home_children_button') as HTMLElement[];
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
        const audioControls = queryDeep([
          '#audio-response',
          '#audio-source',
          '.rc-audiochallenge-play-button',
          'button[aria-label*="audio challenge" i]',
          'input[aria-label*="audio" i]',
          '[id*="captcha" i][id*="audio-response" i]',
          '[class*="captcha" i][class*="audio" i]',
        ].join(','));
        if (audioControls.some(isVisible)) {
          return { detected: true, type: 'audio' as const, frameUrl, details: 'Audio CAPTCHA challenge detected' };
        }

        const sliderControls = queryDeep([
          '.geetest_slider',
          '.geetest_slider_button',
          '.tc-slider-normal',
          '.secsdk-captcha-drag-icon',
          '.captcha-slider',
          '[class*="captcha" i][class*="slider" i]',
          '[class*="slider" i][class*="drag" i]',
          '[aria-label*="slide" i][aria-label*="verify" i]',
        ].join(','));
        if (sliderControls.some(isVisible)) {
          return { detected: true, type: 'slider' as const, frameUrl, details: 'Slider/puzzle CAPTCHA challenge detected' };
        }

        const imageChallenge = queryDeep([
          '.rc-imageselect',
          '.rc-imageselect-table',
          '.task-grid',
          '.challenge-grid',
          '[class*="captcha" i][class*="image" i]',
          '[aria-label*="image challenge" i]',
        ].join(','));
        if (imageChallenge.some(isVisible) && isCaptchaProviderFrame) {
          return { detected: true, type: 'image' as const, frameUrl, details: 'Image-selection CAPTCHA challenge detected' };
        }

        // 1. Cloudflare Turnstile / Challenge
        if (title.includes('just a moment') || title.includes('attention required') || title.includes('verify you are human')) {
          return { detected: true, type: 'cloudflare' as const, frameUrl, details: 'Cloudflare challenge page detected' };
        }
        const cfIframes = queryDeep('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], iframe[src*="cf-chl"]') as HTMLIFrameElement[];
        if (cfIframes.some(isVisible)) {
          return { detected: true, type: 'cloudflare' as const, frameUrl, details: 'Visible Cloudflare Turnstile widget detected' };
        }
        const cfWrappers = queryDeep('.cf-turnstile, #challenge-stage');
        if (cfWrappers.some(isVisible)) {
          return { detected: true, type: 'cloudflare' as const, frameUrl, details: 'Visible Cloudflare challenge stage detected' };
        }

        // 2. Google reCAPTCHA (only if VISIBLE checkbox or challenge popup is present)
        const recaptchaCheckboxes = queryDeep('#recaptcha-anchor, .recaptcha-checkbox, [role="checkbox"][aria-labelledby*="recaptcha"]');
        if (recaptchaCheckboxes.some(isVisible)) {
          return { detected: true, type: 'recaptcha' as const, frameUrl, details: 'Visible reCAPTCHA checkbox detected' };
        }
        const recaptchaBframes = queryDeep('iframe[src*="recaptcha/api2/bframe"], iframe[title*="recaptcha challenge" i], iframe[title*="challenge reCAPTCHA" i]') as HTMLIFrameElement[];
        if (recaptchaBframes.some((f) => {
          const rect = f.getBoundingClientRect();
          return rect.width > 100 && rect.height > 100 && isVisible(f);
        })) {
          return { detected: true, type: 'image' as const, frameUrl, details: 'Active reCAPTCHA image challenge popup detected' };
        }

        // 3. hCaptcha (only if VISIBLE checkbox or challenge popup is present)
        const hcaptchaCheckboxes = queryDeep('#checkbox, [aria-label*="hCaptcha" i][role="checkbox"]');
        if (hcaptchaCheckboxes.some(isVisible)) {
          return { detected: true, type: 'hcaptcha' as const, frameUrl, details: 'Visible hCaptcha checkbox detected' };
        }
        const hcaptchaFrames = queryDeep('iframe[src*="hcaptcha.com"]') as HTMLIFrameElement[];
        if (hcaptchaFrames.some((f) => {
          const rect = f.getBoundingClientRect();
          return rect.width > 100 && rect.height > 100 && isVisible(f);
        })) {
          return { detected: true, type: 'image' as const, frameUrl, details: 'Active hCaptcha image challenge frame detected' };
        }

        // 4. Visual text captcha (img + input both visible and non-empty)
        const imgs = queryDeep('img[src*="captcha" i], img[id*="captcha" i], img[class*="captcha" i]');
        const inputs = queryDeep('input[name*="captcha" i], input[id*="captcha" i], input[placeholder*="captcha" i]');
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

    return detections.sort((a, b) => CAPTCHA_TYPE_PRIORITY[b.type] - CAPTCHA_TYPE_PRIORITY[a.type])[0]
      ?? { detected: false, type: 'unknown' };
  } catch {
    return { detected: false, type: 'unknown' };
  }
}

/**
 * Makes an interactive challenge easy to reach during a human handoff. This
 * never answers or drags the CAPTCHA: it only scrolls the relevant control into
 * view and focuses it. For an audio challenge it may switch to the provider's
 * accessibility mode, leaving playback and the answer to the person.
 */
export async function prepareCaptchaHandoff(
  tabId: number,
  type: CaptchaDetection['type'],
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

        if (challengeType === 'audio' && target.matches('#recaptcha-audio-button, button[aria-label*="audio challenge" i], button[title*="audio challenge" i]')) {
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
 * Injects a script into the tab to automatically solve slider/puzzle CAPTCHAs via smooth drag & drop simulation.
 */
export async function solveSliderCaptcha(tabId: number): Promise<{ success: boolean; message: string }> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: async () => {
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

        const sliderButtons = queryDeep([
          '.geetest_slider_button',
          '.secsdk-captcha-drag-icon',
          '.tc-slider-normal',
          '.captcha-slider-btn',
          '.captcha-slider',
          '[class*="slider" i][class*="btn" i]',
          '[class*="slider" i][class*="button" i]',
          '[class*="slider" i][class*="drag" i]',
          '[aria-label*="slide" i][aria-label*="verify" i]',
        ].join(',')) as HTMLElement[];

        const visibleButton = sliderButtons.find((b) => {
          const rect = b.getBoundingClientRect();
          const style = window.getComputedStyle(b);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        });

        if (!visibleButton) return { found: false };

        const buttonRect = visibleButton.getBoundingClientRect();
        const startX = Math.round(buttonRect.x + buttonRect.width / 2);
        const startY = Math.round(buttonRect.y + buttonRect.height / 2);

        // Find track or container width
        const track = (visibleButton.closest('[class*="track" i], [class*="slider" i], [class*="bar" i], .geetest_slider, .tc-slider') as HTMLElement) || visibleButton.parentElement;
        const trackWidth = track ? track.getBoundingClientRect().width : 280;
        const targetDistance = Math.round(Math.max(120, Math.min(trackWidth - buttonRect.width - 10, trackWidth * 0.72)));

        // Mouse & Pointer drag simulation
        const dispatchDrag = (type: string, x: number, y: number, target: Element) => {
          const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, buttons: 1 };
          target.dispatchEvent(new PointerEvent(type.startsWith('pointer') ? type : `pointer${type.slice(5)}`, opts));
          target.dispatchEvent(new MouseEvent(type.startsWith('mouse') ? type : `mouse${type.slice(7)}`, opts));
        };

        // 1. Pointerdown / Mousedown on button
        dispatchDrag('pointerdown', startX, startY, visibleButton);
        dispatchDrag('mousedown', startX, startY, visibleButton);

        // 2. Continuous interpolated movement with ease-out and human jitter
        const steps = 20;
        for (let i = 1; i <= steps; i++) {
          const progress = i / steps;
          const easeProgress = 1 - Math.pow(1 - progress, 3);
          const currentX = Math.round(startX + targetDistance * easeProgress);
          const currentY = Math.round(startY + (Math.sin(progress * Math.PI) * 2 - 1));

          const currentTarget = document.elementFromPoint(currentX, currentY) || visibleButton;
          dispatchDrag('pointermove', currentX, currentY, currentTarget);
          dispatchDrag('mousemove', currentX, currentY, currentTarget);
          await new Promise((r) => setTimeout(r, 12 + Math.floor(Math.random() * 8)));
        }

        // 3. Pointerup / Mouseup release
        const finalX = startX + targetDistance;
        const finalTarget = document.elementFromPoint(finalX, startY) || visibleButton;
        dispatchDrag('pointerup', finalX, startY, finalTarget);
        dispatchDrag('mouseup', finalX, startY, finalTarget);
        dispatchDrag('click', finalX, startY, finalTarget);

        return { found: true, distance: targetDistance };
      },
    });

    for (const r of results) {
      const res = r.result as { found?: boolean; distance?: number } | null;
      if (res?.found) {
        return { success: true, message: `Slider puzzle dragged smoothly by ${res.distance ?? 0}px.` };
      }
    }

    return { success: false, message: 'Slider puzzle handle not found in DOM.' };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Injects a script into the tab to automatically extract and solve simple visual text CAPTCHAs.
 */
export async function solveVisualTextCaptcha(tabId: number): Promise<{ success: boolean; message: string }> {
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
          return style.display !== 'none' && style.visibility !== 'hidden';
        }

        const imgs = queryDeep('img[src*="captcha" i], img[id*="captcha" i], img[class*="captcha" i], canvas[id*="captcha" i], canvas[class*="captcha" i]') as (HTMLImageElement | HTMLCanvasElement)[];
        const inputs = queryDeep('input[name*="captcha" i], input[id*="captcha" i], input[placeholder*="captcha" i]') as HTMLInputElement[];

        const visibleImg = imgs.find(isVisible);
        const visibleInput = inputs.find(isVisible);

        if (!visibleImg || !visibleInput) return { found: false };

        visibleInput.scrollIntoView({ block: 'center', inline: 'center' });
        visibleInput.focus({ preventScroll: true });

        const possibleCode = visibleImg.getAttribute('alt') || visibleImg.getAttribute('data-code') || visibleImg.getAttribute('title');
        if (possibleCode && possibleCode.length >= 3 && possibleCode.length <= 8 && !possibleCode.toLowerCase().includes('captcha')) {
          visibleInput.value = possibleCode;
          visibleInput.dispatchEvent(new Event('input', { bubbles: true }));
          visibleInput.dispatchEvent(new Event('change', { bubbles: true }));
          return { found: true, solved: true, code: possibleCode };
        }

        return { found: true, solved: false };
      },
    });

    for (const r of results) {
      const res = r.result as { found?: boolean; solved?: boolean; code?: string } | null;
      if (res?.solved) {
        return { success: true, message: `Visual text CAPTCHA automatically filled with "${res.code}".` };
      }
      if (res?.found) {
        return { success: false, message: 'Visual text CAPTCHA image located and focused in tab.' };
      }
    }

    return { success: false, message: 'Visual text CAPTCHA elements not found.' };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
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
  if (targetType === 'slider') {
    const sliderRes = await solveSliderCaptcha(tabId);
    if (sliderRes.success) return { ...sliderRes, type: 'slider' };
    const preparation = await prepareCaptchaHandoff(tabId, 'slider');
    return {
      success: false,
      message: `Slider/puzzle CAPTCHA detected. ${preparation.message} Human verification is required.`,
      type: 'slider',
    };
  }
  if (targetType === 'image') {
    const visualRes = await solveVisualTextCaptcha(tabId);
    if (visualRes.success) return { ...visualRes, type: 'image' };
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
  const rc = await solveRecaptchaChallenge(tabId);
  if (rc.success) return { ...rc, type: 'recaptcha' };
  const hc = await solveHcaptchaChallenge(tabId);
  if (hc.success) return { ...hc, type: 'hcaptcha' };
  const sl = await solveSliderCaptcha(tabId);
  if (sl.success) return { ...sl, type: 'slider' };
  const gen = await solveGenericChallenge(tabId);
  if (gen.success) return { ...gen, type: 'cloudflare' };

  return { success: false, message: 'No solvable CAPTCHA or challenge found on page.', type: 'unknown' };
}
