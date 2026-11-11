/**
 * The daily reminder and the count on the app's icon (design §10). What is due comes from the same
 * places Today reads; the decision is `core/reminders`.
 */
import { localDate, startOfDay } from '../core/dates';
import { reminderDue } from '../core/reminders';
import type { DueNow } from '../core/reminders';
import { listActivity } from '../store/activity';
import type { Database } from '../store/db';
import { getSetting, setSetting } from '../store/settingsTable';
import { cardSummary } from './cards';
import { todayView } from './today';

const SHOWN_KEY = 'reminder.shown';
/** Time on these counts as having studied. */
const STUDY = new Set(['session', 'practice', 'probe', 'cards', 'free']);

export function dueNow(db: Database, now = new Date()): DueNow {
  const today = todayView(db, now);
  return {
    cards: cardSummary(db, null, now).toReview,
    fading: today.fading.length,
    sessionFor: today.session?.goalTitle ?? today.goals.find((g) => g.ideas.atDepth < g.ideas.total)?.title ?? null,
  };
}

function studiedToday(db: Database, now: Date): boolean {
  return listActivity(db, { kinds: ['time'], since: startOfDay(now).toISOString() }).some((a) => STUDY.has(String(a.data['surface'] ?? '')) && a.seconds > 0);
}

/**
 * The reminder to show now, if any. Asking marks the day as reminded when it answers with one, so a
 * restart later that day does not show it again.
 */
export function takeReminder(db: Database, time: string, now = new Date()): string | null {
  const text = reminderDue({ now, time, lastShown: getSetting(db, SHOWN_KEY) ?? null, studiedToday: studiedToday(db, now), due: dueNow(db, now) });
  if (text) setSetting(db, SHOWN_KEY, localDate(now));
  return text;
}

/** The number for the app's icon: flashcards to review now. */
export function badgeCount(db: Database, now = new Date()): number {
  return cardSummary(db, null, now).toReview;
}
