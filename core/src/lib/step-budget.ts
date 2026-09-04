/**
 * How many steps one task is allowed before the loop cuts it off.
 *
 * A single fixed budget treats "fill this form" and "check five days of mail" as the same
 * shape of work, and they are not: the first is a handful of actions, the second is a sweep
 * whose length is set by how many items the page holds. Sixty steps is generous for the first
 * and arithmetically impossible for the second — one message costs three to five steps, so a
 * week of inbox exhausts the budget long before the list does, and the run dies holding a
 * fraction of the answer.
 *
 * So the budget is read off the goal. Raising it is the safe direction: the wall-clock
 * deadline still applies, the wrap-up pressure still fires near the end, and the loop guard
 * still stops a task that is going in circles. What changes is only that a sweep is no longer
 * cut off in the middle for reasons that have nothing to do with the page.
 */

/** Enough for a bounded task: navigate, act, verify, land the answer. */
export const BASE_STEP_BUDGET = 60;

/**
 * A sweep pays per item, so it needs room for the items. Twice the base, not ten times: the
 * point is to let a realistic inbox or result list finish, not to license an endless crawl.
 */
export const SWEEP_STEP_BUDGET = 120;

/** A count this large in the goal means a list, not a single lookup. */
const BULK_COUNT_THRESHOLD = 10;

export interface StepBudget {
  maxSteps: number;
  /** Why this budget was chosen — shown in the exhaustion message so the number is never a mystery. */
  reason: string;
}

/**
 * "за 5 дней", "last 7 days", "за неделю", "past month" — a window over time is a window over
 * however many items fall inside it, which is not something the goal states.
 */
const TIME_WINDOW = [
  /(?:за|последни\p{L}*|прошл\p{L}*)\s+\d+\s*(?:час|дн|день|дней|сут|недел|месяц)/iu,
  /(?:за|последн\p{L}*|прошл\p{L}*)\s+(?:час|день|сутки|неделю|неделя|месяц|год|сегодня|вчера)/iu,
  /(?:last|past|previous|within(?:\s+the)?(?:\s+last)?)\s+(?:\d+\s*)?(?:hour|day|week|month|year)/i,
  /\b(?:today|yesterday|this\s+week|this\s+month)\b/i,
] as const;

/** "все письма", "every result", "each row" — an exhaustive quantifier over a collection. */
const EXHAUSTIVE = [
  /(?<![\p{L}\p{N}])(?:все|всех|всё|каждое|каждый|каждую|каждого)(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])(?:all|every|each)(?![\p{L}\p{N}])/iu,
] as const;

/** An explicit count of things to visit — "20 писем", "top 50 results". */
const BULK_COUNT = /(?<![\p{L}\p{N}])(\d{1,4})\s*(?:писем|письма|сообщени\p{L}*|штук|товар\p{L}*|позиц\p{L}*|стро\p{L}*|результат\p{L}*|ссыл\p{L}*|статей|items?|messages?|emails?|rows?|results?|links?|products?|entries)(?![\p{L}\p{N}])/iu;

function mentionsBulkCount(goal: string): boolean {
  const match = BULK_COUNT.exec(goal);
  return match ? Number(match[1]) >= BULK_COUNT_THRESHOLD : false;
}

/**
 * Reads the goal and returns the step budget for it. Unrecognised goals keep the base budget,
 * so this can only ever widen a task that says out loud that it is a sweep.
 */
export function stepBudgetFor(goal: string): StepBudget {
  const text = goal ?? '';

  if (TIME_WINDOW.some((re) => re.test(text))) {
    return {
      maxSteps: SWEEP_STEP_BUDGET,
      reason: 'the goal spans a window of time, so its length is set by how many items fall inside it',
    };
  }
  if (mentionsBulkCount(text)) {
    return {
      maxSteps: SWEEP_STEP_BUDGET,
      reason: 'the goal names a bulk count of items to visit',
    };
  }
  if (EXHAUSTIVE.some((re) => re.test(text))) {
    return {
      maxSteps: SWEEP_STEP_BUDGET,
      reason: 'the goal asks for every item in a collection',
    };
  }

  return { maxSteps: BASE_STEP_BUDGET, reason: 'bounded task' };
}
