import { describe, expect, it } from 'vitest';
import { clockMinutes, dueSentence, reminderDue } from '../core/reminders';
import { SettingsPatchSchema, SettingsSchema, salvageSettings } from '../settings/schema';
import { logTime } from '../store/activity';
import { openDatabase } from '../store/db';
import { addCapabilities, createGoal } from '../store/goals';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { reviewCard, saveCard } from './cards';
import { recordEvidence } from './evidence';
import { refreshGoalFields } from './knowledge';
import { badgeCount, dueNow, takeReminder } from './reminders';

const at = (hour: number, minute = 0, day = 11) => new Date(2026, 10, day, hour, minute);
const nothing = { cards: 0, fading: 0, sessionFor: null };

describe('the daily reminder', () => {
  it('says what is due in one sentence', () => {
    expect(dueSentence(nothing)).toBeNull();
    expect(dueSentence({ ...nothing, cards: 1 })).toBe('1 flashcard to review.');
    expect(dueSentence({ cards: 12, fading: 5, sessionFor: 'Game theory exam' })).toBe("12 flashcards to review, 5 ideas to practise and today's session for Game theory exam.");
    expect(dueSentence({ ...nothing, sessionFor: 'Game theory exam' })).toBe("Today's session for Game theory exam.");
  });

  it('comes from the chosen time on, once a day, and not on a day already studied', () => {
    const due = { cards: 3, fading: 0, sessionFor: null };
    const ask = (now: Date, extra: Partial<Parameters<typeof reminderDue>[0]> = {}) => reminderDue({ now, time: '18:00', lastShown: null, studiedToday: false, due, ...extra });
    expect(ask(at(17, 59))).toBeNull();
    expect(ask(at(18, 0))).toBe('3 flashcards to review.');
    expect(ask(at(23, 30))).toBe('3 flashcards to review.');
    expect(ask(at(19), { lastShown: '2026-11-11' })).toBeNull();
    expect(ask(at(19), { lastShown: '2026-11-10' })).toBe('3 flashcards to review.');
    expect(ask(at(19), { studiedToday: true })).toBeNull();
    expect(ask(at(19), { due: nothing })).toBeNull();
    expect(ask(at(7, 30), { time: '07:30' })).toBe('3 flashcards to review.');
    expect(clockMinutes('24:00')).toBeNull();
    expect(clockMinutes('7:30')).toBeNull();
  });

  it('reads what is due from the cards and the goals, and remembers the day it reminded', () => {
    const db = openDatabase(':memory:');
    const ids = seedExampleGraph(db);
    const id = (key: string) => ids.get(key) as string;
    expect(dueNow(db, at(19))).toEqual(nothing);
    expect(takeReminder(db, '18:00', at(19))).toBeNull();

    const goal = createGoal(db, 'Game theory exam');
    addCapabilities(db, goal.id, [{ statement: 'Can find equilibria', targets: [{ nodeId: id('nash'), depth: 2 }, { nodeId: id('bestResponse'), depth: 2 }] }]);
    refreshGoalFields(db);
    const card = saveCard(db, { front: 'What does NE stand for?', back: 'Nash equilibrium', nodeIds: [id('nash')] });
    expect(dueNow(db, at(19))).toEqual({ cards: 1, fading: 0, sessionFor: 'Game theory exam' });
    expect(badgeCount(db, at(19))).toBe(1);

    expect(takeReminder(db, '18:00', at(17))).toBeNull();
    expect(takeReminder(db, '18:00', at(19))).toBe("1 flashcard to review and today's session for Game theory exam.");
    expect(takeReminder(db, '18:00', at(20))).toBeNull(); // once a day
    // the next day the learner studies before the time: no reminder
    logTime(db, 'session', { goalId: goal.id }, 600, at(9, 0, 12));
    expect(takeReminder(db, '18:00', at(19, 0, 12))).toBeNull();
    // and the day after, with the card reviewed and the ideas learned, only what is left is named
    reviewCard(db, card.id, 4, at(9, 0, 13));
    for (const key of ['nash', 'bestResponse']) recordEvidence(db, { nodeId: id(key), kind: 'explain', score: 0.9, reasoning: 'r', at: at(9, 0, 13).toISOString() });
    expect(badgeCount(db, at(19, 0, 13))).toBe(0);
    expect(takeReminder(db, '18:00', at(19, 0, 13))).toBeNull();
  });

  it('is on by default at 18:00, can be changed alone, and survives a damaged settings file', () => {
    expect(SettingsSchema.parse({})).toMatchObject({ reminderDaily: true, reminderTime: '18:00', iconBadge: true });
    expect(SettingsPatchSchema.parse({ reminderTime: '07:15' })).toEqual({ reminderTime: '07:15' });
    expect(() => SettingsPatchSchema.parse({ reminderTime: 'soon' })).toThrow();
    expect(salvageSettings({ reminderDaily: false, reminderTime: 'soon', iconBadge: false, concurrency: 99 })).toMatchObject({ reminderDaily: false, reminderTime: '18:00', iconBadge: false, concurrency: 3 });
  });
});
