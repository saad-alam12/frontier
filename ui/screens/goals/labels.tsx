import type { Assessment, GoalDetail, GoalFocus, GoalKind, MaterialRole, SkillStatus } from '../../../backend/api/contract';

export const KIND_OPTIONS: { value: GoalKind; label: string }[] = [
  { value: 'course', label: 'A course' },
  { value: 'personal', label: 'On my own' },
];

export const ASSESSMENT_OPTIONS: { value: Assessment; label: string }[] = [
  { value: 'written_exam', label: 'Written exam' },
  { value: 'oral_exam', label: 'Oral exam' },
  { value: 'presentation_or_project', label: 'Presentation or project' },
  { value: 'outcome', label: 'An outcome' },
  { value: 'none', label: 'Not assessed' },
];

/** As it reads inside a sentence: "1.0 in a written exam". */
export const ASSESSMENT_PHRASE: Record<Assessment, string> = {
  written_exam: 'a written exam',
  oral_exam: 'an oral exam',
  presentation_or_project: 'a presentation or project',
  outcome: 'an outcome',
  none: 'not assessed',
};

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const ASSESSMENT_LABEL: Record<Assessment, string> = Object.fromEntries(ASSESSMENT_OPTIONS.map((o) => [o.value, o.label])) as Record<Assessment, string>;

export const ROLE_OPTIONS: { value: MaterialRole; label: string }[] = [
  { value: 'teaching', label: 'Teaching content' },
  { value: 'practice', label: 'Practice' },
  { value: 'assessment', label: 'Past exam' },
  { value: 'scope', label: 'Scope' },
  { value: 'reference', label: 'Reference' },
];

export const ROLE_LABEL: Record<MaterialRole, string> = Object.fromEntries(ROLE_OPTIONS.map((o) => [o.value, o.label])) as Record<MaterialRole, string>;

export const SKILL_LABEL: Record<SkillStatus, string> = { ready: 'Ready', learning: 'Learning', not_started: 'Not started' };
export const SKILL_TONE: Record<SkillStatus, string> = { ready: 'text-text', learning: 'text-accent-text', not_started: 'text-muted' };

export const isExam = (a: Assessment | null) => a === 'written_exam' || a === 'oral_exam';

/** "Exam date" for exams, "Deadline" for projects and outcomes, nothing for open-ended goals. */
export function dateLabel(a: Assessment | null): string | null {
  if (isExam(a)) return 'Exam date';
  if (a === 'presentation_or_project' || a === 'outcome') return 'Deadline';
  return null;
}

/** 2027-02-12 → "12 February 2027". */
export function formatDate(iso: string | null, withYear = true): string {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', withYear ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long' });
}

export function weeksUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(`${iso}T12:00:00`).getTime() - Date.now();
  return Number.isNaN(ms) ? null : Math.max(0, Math.ceil(ms / (7 * 24 * 3600 * 1000)));
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "2 lectures, 1 exercise sheet, 1 past exam, module description". */
export function materialSummary(materials: { role: MaterialRole; title: string }[], course: boolean): string {
  const count = (role: MaterialRole) => materials.filter((m) => m.role === role).length;
  const parts = [
    count('teaching') ? plural(count('teaching'), course ? 'lecture' : 'teaching source') : '',
    count('practice') ? plural(count('practice'), 'exercise sheet') : '',
    count('assessment') ? plural(count('assessment'), 'past exam') : '',
    ...materials.filter((m) => m.role === 'scope').map((m) => m.title),
    count('reference') ? plural(count('reference'), 'set of notes', 'sets of notes') : '',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'None yet';
}

export function goalName(detail: GoalDetail): string {
  return detail.goal.title ?? detail.goal.text;
}

export const FOCUS_OPTIONS: { value: GoalFocus; label: string; hint: string }[] = [
  { value: 'concepts', label: 'Understand the ideas', hint: 'what things mean and why' },
  { value: 'math', label: 'Mathematical rigour', hint: 'definitions, derivations, proofs' },
  { value: 'practice', label: 'Apply it in practice', hint: 'real tasks, and code where it fits' },
];

/** Pick any number of focuses; none means a balanced mix. */
export function FocusChips({ value, onChange }: { value: GoalFocus[]; onChange: (next: GoalFocus[]) => void }) {
  return (
    <div className="chip-group" role="group" aria-label="What you want from it">
      {FOCUS_OPTIONS.map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={o.value} type="button" className="chip focus-chip" aria-pressed={on} onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}>
            <span>{o.label}</span>
            <span className="chip-hint">{o.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
