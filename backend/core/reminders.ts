/**
 * The daily reminder (design §10): one quiet notification at the time the learner chose, only when
 * something is due and they have not studied yet that day. Pure.
 */
import { localDate } from './dates';

/** What waits for the learner right now. */
export interface DueNow {
  /** Flashcards Review would show. */
  cards: number;
  /** Ideas that are fading and would be practised. */
  fading: number;
  /** The goal whose session is next, when one has ideas left to learn. */
  sessionFor: string | null;
}

export const DEFAULT_REMINDER_TIME = '18:00';
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "18:30" as minutes after midnight; null when it is not a time of day. */
export function clockMinutes(time: string): number | null {
  const m = CLOCK.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What is due, in one sentence; null when nothing is. */
export function dueSentence(due: DueNow): string | null {
  const parts = [
    due.cards > 0 ? `${count(due.cards, 'flashcard', 'flashcards')} to review` : null,
    due.fading > 0 ? `${count(due.fading, 'idea', 'ideas')} to practise` : null,
    due.sessionFor ? `today's session for ${due.sessionFor}` : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  const sentence = parts.length === 1 ? (parts[0] as string) : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/**
 * The reminder to show now, or null. It is shown once a day at most: from the chosen time on, when
 * something is due and the learner has not studied today. A day they already studied needs no nudge.
 */
export function reminderDue(input: { now: Date; time: string; lastShown: string | null; studiedToday: boolean; due: DueNow }): string | null {
  const at = clockMinutes(input.time) ?? clockMinutes(DEFAULT_REMINDER_TIME) ?? 0;
  if (input.now.getHours() * 60 + input.now.getMinutes() < at) return null;
  if (input.lastShown === localDate(input.now) || input.studiedToday) return null;
  return dueSentence(input.due);
}
