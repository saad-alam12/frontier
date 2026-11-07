import type { Assessment, GoalBudget, GoalKind } from '../../backend/api/contract';

/** Whole weeks until an ISO date (0 once it has passed); null without a date. */
export function weeksUntil(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  const ms = new Date(`${iso}T12:00:00`).getTime() - now;
  return Number.isNaN(ms) ? null : Math.max(0, Math.ceil(ms / (7 * 24 * 3600 * 1000)));
}

/**
 * The time a goal starts from when none was given: a course runs to its date (or twelve weeks) at four
 * hours a week; anything else gets ten hours. Every time control shows a real budget, and what it
 * shows is what gets planned and saved.
 */
export function defaultBudget(kind: GoalKind | null, date: string | null, now = Date.now()): GoalBudget {
  const weeks = weeksUntil(date, now);
  if (kind === 'course') return { mode: 'rate', hours: 4, per: 'week', length: Math.max(1, weeks ?? 12), lengthUnit: 'weeks' };
  return { mode: 'total', hours: 10 };
}

/**
 * The assessment a goal starts with once its kind is chosen, so the usual case is one click: most
 * courses end in a written exam, and a goal of your own is usually not assessed. Always changeable.
 */
export function defaultAssessment(kind: GoalKind): Assessment {
  return kind === 'course' ? 'written_exam' : 'none';
}
