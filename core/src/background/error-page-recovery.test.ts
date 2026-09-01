import { describe, expect, it } from 'vitest';
import { isErrorPageFailure } from './agent-loop';

describe('isErrorPageFailure', () => {
  it('recognizes the tab-parked-on-an-error-page throw', () => {
    // Five of the sixteen reachable AssistantBench tasks died on this exact message: a blocking
    // page stranded the tab, takeSnapshot threw before the model was consulted, and the generic
    // retry counter re-took the snapshot three times on a tab that could not change by itself.
    expect(isErrorPageFailure(new Error('Frame with ID 0 is showing error page'))).toBe(true);
    expect(isErrorPageFailure('Frame with ID 0 is showing error page')).toBe(true);
  });

  it('leaves unrelated failures to the normal retry path', () => {
    expect(isErrorPageFailure(new Error('Receiving end does not exist'))).toBe(false);
    expect(isErrorPageFailure(new Error('Content script did not answer "a11y:snapshot" within 30000ms'))).toBe(false);
    expect(isErrorPageFailure(undefined)).toBe(false);
  });
});
