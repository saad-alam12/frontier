/** How far a goal's date is from today, in words: "today", "tomorrow", "in 23 days", "in 12 weeks", "passed". */
export function dueIn(dateIso: string | null, now = new Date()): string | null {
  if (!dateIso) return null;
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return 'passed';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days <= 60) return `in ${days} days`;
  return `in ${Math.round(days / 7)} weeks`;
}
