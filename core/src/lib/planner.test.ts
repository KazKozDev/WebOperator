import { describe, expect, it } from 'vitest';
import { advancePlan, completePlan, hasStructuredPlan, parsePlanSteps, shouldAdvancePlanAfterTool } from './planner';

describe('planner', () => {
  it('activates the first parsed plan step', () => {
    const plan = parsePlanSteps('1. Open the site\n2. Extract the result', 'check result');

    expect(plan.currentStep).toBe(0);
    expect(plan.steps.map((step) => step.status)).toEqual(['active', 'pending']);
  });

  it('advances to the next pending plan step without using browser step indexes', () => {
    const plan = parsePlanSteps('1. Open the site\n2. Extract the result\n3. Report the answer', 'check result');

    advancePlan(plan);

    expect(plan.currentStep).toBe(1);
    expect(plan.steps.map((step) => step.status)).toEqual(['done', 'active', 'pending']);
  });

  it('does not treat every successful click as plan progress', () => {
    const plan = parsePlanSteps('1. Extract the result\n2. Report the answer', 'check result');

    expect(shouldAdvancePlanAfterTool(plan, 'click')).toBe(false);
    expect(shouldAdvancePlanAfterTool(plan, 'extract')).toBe(true);
  });

  it('advances extract work for identify and locate plan steps', () => {
    const plan = parsePlanSteps('1. Identify the target links\n2. Open the links', 'collect linked pages');

    expect(shouldAdvancePlanAfterTool(plan, 'extract')).toBe(true);
  });

  it('allows click progress when the active plan step is explicitly click/open/select work', () => {
    const plan = parsePlanSteps('1. Open the dictionary article\n2. Extract the spelling', 'check spelling');

    expect(shouldAdvancePlanAfterTool(plan, 'click')).toBe(true);
  });

  it('parses common checklist and step formats', () => {
    const plan = parsePlanSteps('- [ ] Step 1: Open the page\n- [ ] 2) Extract data - verify: all rows present', 'check result');

    expect(plan.steps.map((step) => step.description)).toEqual(['Open the page', 'Extract data']);
    expect(hasStructuredPlan(plan)).toBe(true);
  });

  it('does not infer a fallback plan when no model plan is available', () => {
    const plan = parsePlanSteps('', 'check result');

    expect(plan.steps).toHaveLength(0);
    expect(hasStructuredPlan(plan)).toBe(false);
  });

  it('does not infer domain-specific steps from the user goal', () => {
    const plan = parsePlanSteps('', 'как пишется камаз и суперядерный на сайте грамота ру');

    expect(plan.steps).toHaveLength(0);
  });

  it('marks all non-failed plan steps done on final completion', () => {
    const plan = parsePlanSteps('1. Check first\n2. Check second', 'check result');

    completePlan(plan);

    expect(plan.steps.map((step) => step.status)).toEqual(['done', 'done']);
  });
});
