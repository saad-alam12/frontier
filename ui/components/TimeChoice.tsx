import type { GoalBudget, GoalLevel } from '../../backend/api/contract';
import { TimePicker } from './budget';

/** How deep a goal with no time limit goes, said as what the learner gets. */
export const WANTED_LEVEL_OPTIONS: { value: GoalLevel; title: string; line: string }[] = [
  { value: 'intuition', title: 'Big picture', line: 'The main ideas and how they fit, in plain words. No formulas.' },
  { value: 'working', title: 'Working knowledge', line: 'The key ideas with their notation and formulas, used on small examples.' },
  { value: 'rigorous', title: 'In full', line: 'Precise definitions, derivations and proofs.' },
];

export const WANTED_LEVEL_TITLE: Record<GoalLevel, string> = Object.fromEntries(WANTED_LEVEL_OPTIONS.map((o) => [o.value, o.title])) as Record<GoalLevel, string>;

const LIMIT_OPTIONS: { value: 'time' | 'none'; title: string; line: string }[] = [
  { value: 'time', title: 'Fit it to a time', line: 'The plan fits the hours you give it, most useful ideas first.' },
  { value: 'none', title: 'No time limit', line: 'Choose how deep. The plan holds what that takes and says how long.' },
];

/** Cards where exactly one is chosen: a title and one plain line each, arrow keys move the choice. */
function RadioCards<T extends string>({
  label,
  options,
  value,
  onChange,
  stack,
}: {
  label: string;
  options: { value: T; title: string; line: string }[];
  value: T;
  onChange: (value: T) => void;
  /** One under the other when the column is narrow. */
  stack?: boolean;
}) {
  const move = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = options.findIndex((o) => o.value === value);
    const next = options[(at + step + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={stack ? 'radio-cards is-stacked' : 'radio-cards'} onKeyDown={move}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} data-value={o.value} className="radio-card" onClick={() => onChange(o.value)}>
            <span className="radio-card-title">
              <i className="radio-dot" aria-hidden="true" />
              {o.title}
            </span>
            <span className="radio-card-line">{o.line}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * How a goal is sized (design §3.4): fitted to a time (the time picker) or with no time limit, at a
 * depth the learner picks. Both values are kept while switching, so switching back restores them.
 */
export function TimeChoice({
  limited,
  onLimited,
  budget,
  onBudget,
  level,
  onLevel,
  resources,
  allowPerResource,
  defaultWeeks,
}: {
  limited: boolean;
  onLimited: (limited: boolean) => void;
  budget: GoalBudget;
  onBudget: (budget: GoalBudget) => void;
  level: GoalLevel;
  onLevel: (level: GoalLevel) => void;
  resources: number;
  allowPerResource: boolean;
  defaultWeeks: number | null;
}) {
  return (
    <div className="time-choice">
      <RadioCards label="Time or depth" options={LIMIT_OPTIONS} value={limited ? 'time' : 'none'} onChange={(v) => onLimited(v === 'time')} />
      {limited ? (
        <TimePicker value={budget} onChange={onBudget} resources={resources} allowPerResource={allowPerResource} defaultWeeks={defaultWeeks} />
      ) : (
        <div className="flex flex-col gap-[12px]">
          <RadioCards label="How deep" options={WANTED_LEVEL_OPTIONS} value={level} onChange={onLevel} stack />
        </div>
      )}
    </div>
  );
}
