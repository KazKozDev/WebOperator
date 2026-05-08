import type { RetryStrategy, VerificationResult } from './types';

export interface RetryDecision {
  shouldRetry: boolean;
  strategy: RetryStrategy;
  waitMs: number;
  promptAddition: string;
  maxRetries: number;
}

export function decideRetry(
  verification: VerificationResult,
  retryCount: number,
  maxRetries: number,
): RetryDecision {
  if (retryCount >= maxRetries) {
    return {
      shouldRetry: false,
      strategy: 'ask_user',
      waitMs: 0,
      promptAddition: '',
      maxRetries,
    };
  }

  const strategy = verification.recommendedStrategy;
  const base = { shouldRetry: true, strategy, maxRetries };

  switch (strategy) {
    case 'close_popup':
      return {
        ...base,
        waitMs: 500,
        promptAddition: `Popup detected: ${verification.popupRefs?.join(', ') ?? 'unknown'}. Close it (button "Accept", "Close", "OK" or X), then continue the task.`,
      };

    case 'different_selector':
      return {
        ...base,
        waitMs: 300,
        promptAddition: retryCount < 2
          ? 'Element not found by current selector. Find an alternative way to interact (different ref with similar name, parent container, adjacent button).'
          : 'Action failed via DOM. Try finding the same element by visible text, scroll, or an alternative path.',
      };

    case 'wait_and_retry':
      return {
        ...base,
        waitMs: 2000 + retryCount * 1000,
        promptAddition: `Page may not have finished loading. Wait ${2000 + retryCount * 1000}ms and check the snapshot.`,
      };

    case 'scroll_to_element':
      return {
        ...base,
        waitMs: 300,
        promptAddition: 'Element may be outside the viewport. Scroll and check the snapshot.',
      };

    case 'coordinates_click':
      return {
        ...base,
        waitMs: 200,
        promptAddition: 'DOM click failed. System will attempt CDP click using element bbox coordinates.',
      };

    case 'refresh_page':
      return {
        ...base,
        waitMs: 3000,
        promptAddition: 'Page is in an inconsistent state. Refresh the page (navigate to the same URL) and restart the step.',
      };

    case 'try_alternative':
      return {
        ...base,
        waitMs: 500,
        promptAddition: retryCount < 2
          ? 'Action did not work. Think of an alternative approach: different navigation path, different element, site search.'
          : 'Previous attempts failed. If there is an alternative way to complete the task — use it. Otherwise call done with success="false".',
      };

    case 'retry_same':
    default:
      return {
        ...base,
        shouldRetry: true,
        strategy: retryCount === 0 ? 'retry_same' : 'different_selector',
        waitMs: 300 + retryCount * 300,
        promptAddition: retryCount === 0
          ? `Action failed (attempt 1/${maxRetries}). Wait for page to settle and retry.`
          : `Action failed again (attempt ${retryCount + 1}/${maxRetries}). Try a different element, selector, or approach — scroll, check another tab, use keyboard.`,
      };
  }
}

export function retryPromptForStep(
  retryCount: number,
  maxRetries: number,
  strategy: RetryStrategy,
  originalError: string,
): string {
  const header = `[RETRY ${retryCount}/${maxRetries}] Previous action failed: ${originalError}`;

  switch (strategy) {
    case 'close_popup':
      return `${header}\nA popup/dialog was detected on the page. Find the close button and click it.`;
    case 'different_selector':
      return `${header}\nElement changed or not found. Find a similar element by name/text.`;
    case 'wait_and_retry':
      return `${header}\nPage is loading. Wait longer and take a new snapshot.`;
    case 'scroll_to_element':
      return `${header}\nScroll the page — the element may be outside the visible area.`;
    case 'coordinates_click':
      return `${header}\nSystem will perform a coordinate click via CDP.`;
    case 'refresh_page':
      return `${header}\nRefresh the page and retry the step.`;
    case 'try_alternative':
      return `${header}\nFind an alternative way to complete the task.`;
    default:
      return `${header}\nWait for the page to settle, then retry. If it fails again, try a different element.`;
  }
}
