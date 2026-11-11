/**
 * Calendar arithmetic in the learner's own time zone. Days and weeks are stepped with the calendar
 * (`setDate`), never by adding 24 hours: a day is 23 or 25 hours long when the clocks change, and a
 * local midnight is the day before in UTC east of Greenwich.
 */

/** The local calendar date, as YYYY-MM-DD. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight at the start of the day `d` falls on. */
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** `n` calendar days after `d`, at the same local time of day. */
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Local midnight of the Monday of `d`'s week. */
export function weekStart(d: Date): Date {
  const x = startOfDay(d);
  return addDays(x, -((x.getDay() + 6) % 7));
}

/** Whole calendar days from `from`'s day to `to`'s day. */
export function daysBetween(from: Date, to: Date): number {
  const a = startOfDay(from);
  const b = startOfDay(to);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000);
}
