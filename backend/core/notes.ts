/**
 * A goal as Markdown notes to keep outside the app: its skills, each idea with what it says, the
 * learner's own words and handle, how far they got, and the flashcards on it. Pure text building;
 * the service gathers the data.
 */
export interface NotesIdea {
  name: string;
  statement: string;
  /** The depth word the learner reached ("Explain"), or null when not learned yet. */
  reached: string | null;
  ownWords: string | null;
  handle: string | null;
  cards: { front: string; back: string }[];
}

export interface NotesInput {
  title: string;
  text: string;
  context: string | null;
  scope: string | null;
  skills: { statement: string; ideas: NotesIdea[] }[];
  /** For the line under the title. */
  exportedOn: string;
}

/** Markdown and KaTeX pass through untouched, so formulas stay formulas in any Markdown reader. */
export function goalNotes(input: NotesInput): string {
  const lines: string[] = [`# ${input.title}`, '', `${input.text}`, ''];
  if (input.context) lines.push(`> ${input.context.trim().replace(/\n/g, '\n> ')}`, '');
  if (input.scope) lines.push(`*${input.scope.trim()}*`, '');
  lines.push(`Exported from Frontier on ${input.exportedOn}.`, '');
  // an idea several skills need is written out once, under the first
  const written = new Set<string>();
  for (const skill of input.skills) {
    lines.push(`## ${skill.statement}`, '');
    for (const idea of skill.ideas) {
      if (written.has(idea.name)) {
        lines.push(`- ${idea.name} (above)`, '');
        continue;
      }
      written.add(idea.name);
      lines.push(`### ${idea.name}`, '', idea.statement, '');
      lines.push(`*${idea.reached ? `Learned to: ${idea.reached}` : 'Not learned yet'}*`, '');
      if (idea.ownWords) lines.push(`**In my words:** ${idea.ownWords}`, '');
      if (idea.handle) lines.push(`**Handle:** ${idea.handle}`, '');
      if (idea.cards.length) {
        lines.push('**Flashcards**', '');
        // two trailing spaces: a line break, so the answer sits under its question in any reader
        for (const c of idea.cards) lines.push(`- **Q:** ${oneLine(c.front)}  `, `  **A:** ${oneLine(c.back)}`);
        lines.push('');
      }
    }
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** Card text inside a list item: line breaks become spaces, display math stays inline. */
function oneLine(text: string): string {
  return text.replace(/\$\$([\s\S]*?)\$\$/g, (_, m: string) => `$${m.trim()}$`).replace(/\s*\n\s*/g, ' ').trim();
}

/** The depth ladder's words for how far an idea was learned (design §2.3); null for not yet. */
export function reachedWord(depth: number): string | null {
  return ['recognize it', 'explain it', 'derive it', 'apply it', 'transfer it'][depth - 1] ?? null;
}

/** A file name for the notes: the title in plain words. */
export function notesFileName(title: string): string {
  const base = title.replace(/[$\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Goal';
  return `${base}.md`;
}
