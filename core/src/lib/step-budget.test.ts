import { describe, expect, it } from 'vitest';
import { BASE_STEP_BUDGET, SWEEP_STEP_BUDGET, stepBudgetFor } from './step-budget';

const budget = (goal: string) => stepBudgetFor(goal).maxSteps;

describe('stepBudgetFor', () => {
  it('keeps the base budget for a bounded task', () => {
    expect(budget('заполни форму регистрации')).toBe(BASE_STEP_BUDGET);
    expect(budget('log in and download the invoice')).toBe(BASE_STEP_BUDGET);
    expect(budget('напиши письмо Ивану про встречу')).toBe(BASE_STEP_BUDGET);
  });

  it('widens the budget for a window of time', () => {
    // The case this exists for: five days of inbox is however many messages that is.
    expect(budget('проверь почту за 5 дней')).toBe(SWEEP_STEP_BUDGET);
    expect(budget('что пришло за неделю')).toBe(SWEEP_STEP_BUDGET);
    expect(budget('summarise my mail from the last 7 days')).toBe(SWEEP_STEP_BUDGET);
    expect(budget('what came in today')).toBe(SWEEP_STEP_BUDGET);
  });

  it('widens the budget for an exhaustive quantifier', () => {
    expect(budget('собери все цены на ноутбуки')).toBe(SWEEP_STEP_BUDGET);
    expect(budget('extract every row of the table')).toBe(SWEEP_STEP_BUDGET);
  });

  it('widens the budget for a bulk count but not for a small one', () => {
    expect(budget('прочитай 40 писем и сделай сводку')).toBe(SWEEP_STEP_BUDGET);
    expect(budget('collect the top 50 results')).toBe(SWEEP_STEP_BUDGET);
    // Three items is not a sweep; the base budget covers it comfortably.
    expect(budget('сравни 3 товара по цене')).toBe(BASE_STEP_BUDGET);
  });

  it('does not fire on a quantifier buried inside another word', () => {
    // "все" inside "всего", "all" inside "allow" used to be the obvious trap here.
    expect(budget('узнай сколько всего стоит доставка')).toBe(BASE_STEP_BUDGET);
    expect(budget('check whether the site allows guest checkout')).toBe(BASE_STEP_BUDGET);
  });

  it('always states a reason for the budget it picked', () => {
    expect(stepBudgetFor('проверь почту за 5 дней').reason).toMatch(/window of time/);
    expect(stepBudgetFor('заполни форму').reason).toBe('bounded task');
  });
});
