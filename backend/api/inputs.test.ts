import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { ApiInput, ApiName } from './contract';
import { INPUTS, checkInput } from './inputs';

/** Every field path of a type, nested objects and arrays included: `form.budget.hours`. */
type Paths<T> = T extends readonly (infer U)[] ? Paths<U> : T extends object ? { [K in keyof T & string]-?: K | `${K}.${Paths<NonNullable<T[K]>>}` }[keyof T & string] : never;
/** Fields the contract has that a schema would drop without a word (zod drops keys it does not know). */
type Unchecked = { [N in ApiName]: Exclude<Paths<NonNullable<ApiInput<N>>>, Paths<NonNullable<z.output<(typeof INPUTS)[N]>>>> extends infer Missing ? ([Missing] extends [never] ? never : `${N}: ${Missing & string}`) : never }[ApiName];
// fails to compile, naming the field, when a schema leaves out a field the window may send
const everyFieldChecked: [Unchecked] extends [never] ? true : Unchecked = true;

const form = (extra: Record<string, unknown> = {}) => ({ form: { text: 'Pass the game theory exam', materials: [], ...extra } });

describe('inputs from the window', () => {
  it('has a schema for every method, covering every field', () => {
    expect(everyFieldChecked).toBe(true);
    expect(Object.keys(INPUTS).length).toBeGreaterThan(100);
  });

  it('takes a goal date only as a real calendar date', () => {
    expect(checkInput('goals.create', form({ date: '2026-12-18' }))).toMatchObject({ ok: true });
    expect(checkInput('goals.create', form({ date: null }))).toMatchObject({ ok: true });
    expect(checkInput('goals.create', form({ date: 'next Friday' }))).toEqual({ ok: false, message: 'A date, like 2026-12-18.', field: 'form.date' });
    expect(checkInput('goals.create', form({ date: '2026-02-30' }))).toEqual({ ok: false, message: 'That date does not exist.', field: 'form.date' });
    expect(checkInput('goals.update', { goalId: 'goal_1', form: { date: 'soon' } })).toMatchObject({ ok: false, field: 'form.date' });
    expect(checkInput('stats.week', { weekOf: '12 May' })).toMatchObject({ ok: false, field: 'weekOf' });
  });

  it('refuses a weekly budget that is not a number of hours', () => {
    const budget = { mode: 'rate', hours: 'five', per: 'week', length: 10, lengthUnit: 'weeks' };
    expect(checkInput('goals.create', form({ budget }))).toMatchObject({ ok: false, field: 'form.budget.hours' });
    expect(checkInput('goals.preview', { goalId: 'goal_1', budget: { ...budget, hours: 5 } })).toMatchObject({ ok: true });
  });

  it('refuses text that is too long, with the limit in plain words', () => {
    const response = { answer: 'x'.repeat(20_001) };
    expect(checkInput('session.respond', { sessionId: 'session_1', response })).toEqual({ ok: false, message: 'At most 20,000 characters.', field: 'response.answer' });
    expect(checkInput('dialogue.answer', { dialogueId: 'd', answer: 'An answer.' })).toMatchObject({ ok: true });
  });

  it('refuses a method that takes nothing being sent something, and drops fields it does not know', () => {
    expect(checkInput('today.view', undefined)).toEqual({ ok: true, data: undefined });
    expect(checkInput('today.view', { goalId: 'x' })).toMatchObject({ ok: false });
    expect(checkInput('cards.queue', { goalId: null, extra: 'dropped' })).toEqual({ ok: true, data: { goalId: null } });
  });

  it('fills a missing nullable choice with none', () => {
    expect(checkInput('stats.week', {})).toEqual({ ok: true, data: { weekOf: null } });
    expect(checkInput('cards.review', { cardId: 'card_1', rating: 5, goalId: null })).toMatchObject({ ok: false, field: 'rating' });
  });
});
