/**
 * For fake tutors (tests and the screenshot sandbox): the card a tutor call asks for, read from its
 * task. A call that grades lists score bands and the card each leads to; the fake picks the band of the
 * score it gives. Other calls name one stage. Null: no card.
 */
export function stageAsked(text: string, score: number | null): string | null {
  const task = text.split('## Task').pop() ?? '';
  const bands = [...task.matchAll(/^- Score (?:below ([\d.]+)|([\d.]+) to below ([\d.]+)|([\d.]+) or more|any score): (?:the \*\*(\w+)\*\* card|no card)/gm)];
  if (bands.length && score !== null) {
    for (const band of bands) {
      const from = Number(band[2] ?? band[4] ?? 0);
      const below = band[1] ?? band[3];
      if (score >= from && (below === undefined || score < Number(below))) return band[5] ?? null;
    }
    return null;
  }
  return /[Pp]roduce the \*\*(\w+)\*\* card/.exec(task)?.[1] ?? null;
}
