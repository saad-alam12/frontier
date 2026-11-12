/**
 * A goal's notes (design §10, "Notes"): its skills, each idea with what it says, the learner's own
 * words, handle and free note, how far they got, worked examples and the flashcards on it; as Markdown
 * to keep outside the app, and as a one-page cheat sheet. Pure text building; the service gathers the data.
 */
export interface NotesIdea {
  name: string;
  statement: string;
  /** The depth word the learner reached ("Explain"), or null when not learned yet. */
  reached: string | null;
  ownWords: string | null;
  handle: string | null;
  /** The learner's free note on the idea. */
  note: string | null;
  /** Worked examples the tutor wrote on it, newest first. */
  examples: string[];
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
      if (idea.note) lines.push('**My note**', '', idea.note.trim(), '');
      for (const example of idea.examples) lines.push('**Worked example**', '', example.trim(), '');
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
  return `${plainTitle(title)}.md`;
}

/** A file name for the notes or the cheat sheet as a PDF. */
export function notesPdfName(title: string, kind: 'notes' | 'sheet'): string {
  return `${plainTitle(title)} ${kind === 'notes' ? 'notes' : 'cheat sheet'}.pdf`;
}

function plainTitle(title: string): string {
  return title.replace(/[$\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Goal';
}

// ---------- the cheat sheet ----------

/** About what a page of A4 holds in the sheet's small type, in characters of text. */
export const SHEET_CHARS = 4800;
/** Room each entry takes beyond its text: its name, spacing. */
const ENTRY_OVERHEAD = 60;
const TEXT_CHARS = 240;

export interface SheetInputIdea {
  nodeId: string;
  name: string;
  statement: string;
  ownWords: string | null;
  handle: string | null;
  cards: { front: string; back: string }[];
  core: boolean;
  learned: boolean;
  /** Probability of recall now; null when not learned. */
  recall: number | null;
}

export interface SheetIdea {
  nodeId: string;
  name: string;
  /** The learner's own words when they have them, else the idea's statement; shortened. */
  text: string;
  handle: string | null;
  /** Flashcards that hold math: the formulas to have at hand. */
  formulas: { front: string; back: string }[];
}

export interface CheatSheet {
  skills: { statement: string; ideas: SheetIdea[] }[];
  /** Ideas left out to fit the page. */
  left: number;
}

/**
 * One page before an exam: each idea once, in the skills' order, as a line in the learner's words with
 * its formulas. When it does not fit, what goes first is what matters most: core ideas, then learned
 * ones that are fading, then the rest; `all` keeps everything.
 */
export function cheatSheet(skills: { statement: string; ideas: SheetInputIdea[] }[], options: { all?: boolean; budget?: number } = {}): CheatSheet {
  const seen = new Set<string>();
  const entries: { skill: number; order: number; input: SheetInputIdea; entry: SheetIdea; size: number }[] = [];
  skills.forEach((skill, k) =>
    skill.ideas.forEach((input) => {
      if (seen.has(input.nodeId)) return;
      seen.add(input.nodeId);
      const entry: SheetIdea = { nodeId: input.nodeId, name: input.name, text: shorten(input.ownWords ?? input.statement, TEXT_CHARS), handle: input.handle, formulas: input.cards.filter((c) => /\$/.test(c.back)) };
      const size = ENTRY_OVERHEAD + entry.name.length + entry.text.length + (entry.handle?.length ?? 0) + entry.formulas.reduce((n, f) => n + f.front.length + f.back.length + 20, 0);
      entries.push({ skill: k, order: entries.length, input, entry, size });
    }),
  );
  let kept = entries;
  if (!options.all) {
    const budget = options.budget ?? SHEET_CHARS;
    const rank = (e: (typeof entries)[number]) => [e.input.core ? 0 : 1, e.input.learned ? 0 : 1, e.input.recall ?? 1];
    const byPriority = [...entries].sort((a, b) => {
      const [ra, rb] = [rank(a), rank(b)];
      for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return (ra[i] as number) - (rb[i] as number);
      return a.order - b.order;
    });
    let used = 0;
    const chosen = new Set<number>();
    for (const e of byPriority) {
      if (used + e.size > budget && chosen.size > 0) continue;
      used += e.size;
      chosen.add(e.order);
    }
    kept = entries.filter((e) => chosen.has(e.order));
  }
  return {
    skills: skills.map((skill, k) => ({ statement: skill.statement, ideas: kept.filter((e) => e.skill === k).map((e) => e.entry) })).filter((s) => s.ideas.length > 0),
    left: entries.length - kept.length,
  };
}

/** Text cut at a word near `max`, never inside a formula, with an ellipsis when cut. */
export function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  let cut = flat.lastIndexOf(' ', max);
  if (cut < max * 0.6) cut = max;
  // an odd number of math delimiters ($ or $$) before the cut means it falls inside a formula: cut before it
  const opened = [...flat.matchAll(/(?<!\\)\$\$?/g)].map((m) => m.index).filter((i) => i < cut);
  if (opened.length % 2 === 1) cut = opened[opened.length - 1] as number;
  return `${flat.slice(0, Math.max(0, cut)).trimEnd()}…`;
}
