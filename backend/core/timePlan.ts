/**
 * "I have 15, 30, 45 or 60 minutes" (design §10, Today): what to do in that time. Flashcards first
 * (they are quick and due today), never more than a third of the time unless nothing else waits;
 * then practice when the lead goal's ideas are fading, else a session fitted to what is left. Pure.
 */

export const TIME_CHOICES = [15, 30, 45, 60] as const;

/** About four flashcards a minute. */
const CARDS_PER_MINUTE = 4;
/** A practice problem takes about this long, answer and solution read. */
const PROBLEM_MINUTES = 5;
/** Less than this is not worth a session: one idea needs at least ten minutes. */
const MIN_SESSION = 10;

export type TimeStep =
  | { kind: 'cards'; minutes: number; cards: number }
  | { kind: 'practice'; minutes: number; goalId: string; problems: number }
  | { kind: 'session'; minutes: number; goalId: string };

export interface TimeInput {
  minutes: number;
  cardsDue: number;
  /** The goal Today leads with, and what its schedule suggests; null with no active goal. */
  goal: { goalId: string; mode: 'build' | 'deepen' | 'consolidate'; fading: number } | null;
}

const roundUp5 = (n: number) => Math.ceil(n / 5) * 5;

export function fillTime(input: TimeInput): TimeStep[] {
  const steps: TimeStep[] = [];
  let left = input.minutes;
  if (input.cardsDue > 0) {
    const need = roundUp5(input.cardsDue / CARDS_PER_MINUTE);
    const share = input.goal ? Math.max(5, Math.floor(input.minutes / 15) * 5) : input.minutes;
    const minutes = Math.min(need, share, input.minutes);
    steps.push({ kind: 'cards', minutes, cards: Math.min(input.cardsDue, minutes * CARDS_PER_MINUTE) });
    left -= minutes;
  }
  const goal = input.goal;
  if (!goal || left < MIN_SESSION) return steps;
  if (goal.mode === 'consolidate' && goal.fading > 0) {
    const problems = Math.max(1, Math.min(4, Math.ceil(goal.fading / 2), Math.floor(left / PROBLEM_MINUTES)));
    const minutes = Math.min(left, problems * PROBLEM_MINUTES);
    steps.push({ kind: 'practice', minutes, goalId: goal.goalId, problems });
    left -= minutes;
  }
  if (left >= MIN_SESSION) steps.push({ kind: 'session', minutes: left, goalId: goal.goalId });
  return steps;
}
