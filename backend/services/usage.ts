/** How much of the model Frontier used: today and the last seven days, for Settings (design §10). */
import type { Database } from '../store/db';
import { callTotals } from '../store/modelCalls';
import type { CallTotals } from '../store/modelCalls';

export interface UsageView {
  today: CallTotals;
  week: CallTotals;
  /** The jobs that used most in the last seven days, most first. */
  topJobs: (CallTotals & { role: string })[];
}

const DAY = 86_400_000;

export function usageView(db: Database, now = new Date()): UsageView {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week = callTotals(db, new Date(midnight.getTime() - 6 * DAY).toISOString());
  return { today: callTotals(db, midnight.toISOString()).all, week: week.all, topJobs: week.byRole.slice(0, 3) };
}
