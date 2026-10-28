import { useEffect, useState } from 'react';
import type { GoalBudget, GoalPlan, GoalProgress, PlanPreview } from '../../backend/api/contract';
import { budgetMinutes, formatHours } from '../../backend/core/budget';

type Mode = 'total' | 'week' | 'day' | 'resource';

const MODES: { value: Mode; label: string }[] = [
  { value: 'total', label: 'In total' },
  { value: 'week', label: 'Per week' },
  { value: 'day', label: 'Per day' },
  { value: 'resource', label: 'Per lecture' },
];

/** Slider ranges in hours (log scale), and the quick picks under it. */
const RANGE: Record<Mode, { min: number; max: number; picks: { hours: number; label: string }[] }> = {
  total: {
    min: 0.5,
    max: 400,
    picks: [
      { hours: 2, label: 'an article or a video' },
      { hours: 10, label: 'a short course' },
      { hours: 40, label: 'a book' },
      { hours: 120, label: 'a semester course' },
    ],
  },
  week: { min: 0.5, max: 40, picks: [{ hours: 2, label: 'light' }, { hours: 5, label: 'steady' }, { hours: 10, label: 'serious' }] },
  day: { min: 0.25, max: 12, picks: [{ hours: 1, label: 'an hour' }, { hours: 3, label: 'focused' }, { hours: 6, label: 'cramming' }] },
  resource: { min: 0.25, max: 10, picks: [{ hours: 1, label: 'skim' }, { hours: 2, label: 'solid' }, { hours: 4, label: 'thorough' }] },
};

const UNIT_LABEL: Record<Mode, string> = { total: 'hours in total', week: 'hours a week', day: 'hours a day', resource: 'hours per lecture' };

function modeOf(b: GoalBudget | null): Mode {
  if (!b) return 'total';
  if (b.mode === 'rate') return b.per;
  return b.mode;
}

const toSlider = (hours: number, mode: Mode) => {
  const { min, max } = RANGE[mode];
  return Math.round((Math.log(Math.max(min, Math.min(max, hours)) / min) / Math.log(max / min)) * 1000);
};
const fromSlider = (v: number, mode: Mode) => {
  const { min, max } = RANGE[mode];
  const raw = min * Math.pow(max / min, v / 1000);
  return raw < 2 ? Math.round(raw * 4) / 4 : raw < 10 ? Math.round(raw * 2) / 2 : Math.round(raw);
};

/**
 * How much time a goal gets: a total, a rhythm for a length, or hours per lecture. Whatever the
 * form, it shows the true total it comes to, because that is what the plan is made for.
 */
export function TimePicker({
  value,
  onChange,
  resources,
  allowPerResource,
  defaultWeeks,
}: {
  value: GoalBudget | null;
  onChange: (b: GoalBudget) => void;
  /** Teaching resources the goal has now (a per-lecture budget counts them). */
  resources: number;
  allowPerResource: boolean;
  /** Length suggested for a rhythm: the weeks to the goal's date, if it has one. */
  defaultWeeks: number | null;
}) {
  const mode = modeOf(value);
  const hours = value?.hours ?? 10;
  const length = value?.mode === 'rate' ? value.length : (defaultWeeks ?? 8);
  const lengthUnit = value?.mode === 'rate' ? value.lengthUnit : 'weeks';
  const [text, setText] = useState(String(hours));
  useEffect(() => setText(String(hours)), [hours]);

  const build = (next: { mode?: Mode; hours?: number; length?: number; lengthUnit?: 'days' | 'weeks' | 'months' }): GoalBudget => {
    const m = next.mode ?? mode;
    const h = next.hours ?? hours;
    if (m === 'total') return { mode: 'total', hours: h };
    if (m === 'resource') return { mode: 'resource', hours: h };
    return { mode: 'rate', hours: h, per: m, length: Math.max(1, next.length ?? length), lengthUnit: next.lengthUnit ?? lengthUnit };
  };
  const switchMode = (m: Mode) => {
    // keep the total about the same when switching between forms
    const total = (budgetMinutes(value, resources) ?? 600) / 60;
    const weeks = lengthUnit === 'months' ? length * 4.345 : lengthUnit === 'days' ? length / 7 : length;
    const h = m === 'total' ? total : m === 'week' ? total / Math.max(1, weeks) : m === 'day' ? total / Math.max(1, weeks * 7) : total / Math.max(1, resources);
    onChange(build({ mode: m, hours: fromSlider(toSlider(h, m), m) }));
  };

  const total = budgetMinutes(value ?? build({}), resources) ?? 0;
  const modes = MODES.filter((m) => m.value !== 'resource' || allowPerResource);
  return (
    <div className="time-picker">
      <div role="radiogroup" aria-label="How you give the time" className="segmented">
        {modes.map((m) => (
          <button key={m.value} type="button" role="radio" aria-checked={mode === m.value} onClick={() => switchMode(m.value)}>
            {m.label}
          </button>
        ))}
      </div>

      <div className="time-amount">
        <div className="stepper">
          <button type="button" aria-label="Less time" onClick={() => onChange(build({ hours: fromSlider(Math.max(0, toSlider(hours, mode) - 60), mode) }))}>
            −
          </button>
          <input
            aria-label={UNIT_LABEL[mode]}
            inputMode="decimal"
            value={text}
            onChange={(e) => {
              const raw = e.target.value.replace(',', '.').replace(/[^0-9.]/g, '');
              setText(raw);
              const n = Number(raw);
              if (n > 0) onChange(build({ hours: n }));
            }}
          />
          <button type="button" aria-label="More time" onClick={() => onChange(build({ hours: fromSlider(Math.min(1000, toSlider(hours, mode) + 60), mode) }))}>
            +
          </button>
        </div>
        <span className="time-unit">{UNIT_LABEL[mode]}</span>
        {(mode === 'week' || mode === 'day') && (
          <span className="time-length">
            <span className="text-secondary">for</span>
            <input className="input length-input" aria-label="How long" inputMode="numeric" value={length} onChange={(e) => onChange(build({ length: Number(e.target.value.replace(/\D/g, '')) || 1 }))} />
            <select className="input length-unit" aria-label="Length unit" value={lengthUnit} onChange={(e) => onChange(build({ lengthUnit: e.target.value as 'days' | 'weeks' | 'months' }))}>
              <option value="days">days</option>
              <option value="weeks">weeks</option>
              <option value="months">months</option>
            </select>
          </span>
        )}
      </div>

      <input type="range" className="time-slider" min={0} max={1000} value={toSlider(hours, mode)} aria-label="Time" onChange={(e) => onChange(build({ hours: fromSlider(Number(e.target.value), mode) }))} />

      <div className="time-picks">
        {RANGE[mode].picks.map((p) => (
          <button key={p.hours} type="button" className={p.hours === hours ? 'mini-chip is-on' : 'mini-chip'} onClick={() => onChange(build({ hours: p.hours }))}>
            {formatHours(p.hours * 60)} · {p.label}
          </button>
        ))}
      </div>

      <div className="time-total" aria-live="polite">
        <span className="time-total-number">{formatHours(total)}</span>
        <span className="text-secondary">
          {mode === 'total'
            ? 'for the whole goal'
            : mode === 'resource'
              ? `in total for ${resources || 1} ${resources === 1 || !resources ? 'lecture' : 'lectures'}, growing as lectures arrive`
              : 'in total, the time the plan is made for'}
        </span>
      </div>
    </div>
  );
}

/**
 * Time as one bar: spent, then the time the plan holds ahead, then budget the plan leaves free. A tick
 * marks where the budget's rhythm puts you by now.
 */
export function BudgetBar({ progress, compact, caption }: { progress: Pick<GoalProgress, 'totalMinutes' | 'spentMinutes' | 'expectedByNow'> & { plannedMinutes: number }; compact?: boolean; caption?: boolean }) {
  const { totalMinutes, spentMinutes, expectedByNow, plannedMinutes } = progress;
  const total = Math.max(totalMinutes ?? spentMinutes + plannedMinutes, 1);
  const spentPct = Math.min(100, (spentMinutes / total) * 100);
  const plannedPct = Math.min(100 - spentPct, (plannedMinutes / total) * 100);
  const tick = expectedByNow !== null && totalMinutes ? Math.min(100, (expectedByNow / total) * 100) : null;
  const label = `${formatHours(spentMinutes)} spent, ${formatHours(plannedMinutes)} planned ahead${totalMinutes ? ` of ${formatHours(totalMinutes)}` : ''}`;
  return (
    <div className={compact ? 'budget-bar is-compact' : 'budget-bar'}>
      <div className="budget-track" role="img" aria-label={label} title={label}>
        <span className="budget-spent" style={{ width: `${spentPct}%` }} />
        <span className="budget-planned" style={{ left: `${spentPct}%`, width: `${plannedPct}%` }} />
        {tick !== null && <span className="budget-tick" style={{ left: `${tick}%` }} title={`Where your rhythm puts you by now: ${formatHours(expectedByNow ?? 0)}`} />}
      </div>
      {compact && caption && (
        <div className="t-caption text-muted">
          {formatHours(spentMinutes)} spent{totalMinutes !== null ? ` of ${formatHours(totalMinutes)}` : ''} · {formatHours(plannedMinutes)} planned ahead
        </div>
      )}
      {!compact && (
        <div className="budget-legend">
          <span>
            <i className="swatch is-spent" /> {formatHours(spentMinutes)} spent
          </span>
          <span>
            <i className="swatch is-planned" /> {formatHours(plannedMinutes)} planned ahead
          </span>
          {totalMinutes !== null && <span className="text-muted">of {formatHours(totalMinutes)}</span>}
        </div>
      )}
    </div>
  );
}

/** The ideas of a plan as a field of dots: deep, overview, already yours, left out. */
export function IdeaField({ ideas }: { ideas: PlanPreview['ideas'] }) {
  return (
    <div className="idea-field-wrap">
      <ul className="idea-field" aria-label="Ideas in the plan">
        {ideas.map((i) => {
          const known = i.plannedDepth > 0 && i.currentDepth >= i.plannedDepth;
          const kind = known ? 'known' : i.plannedDepth >= 3 ? 'deep' : i.plannedDepth >= 1 ? 'overview' : 'cut';
          return (
            <li key={i.nodeId} className={`idea-dot is-${kind}`} title={`${i.name}: ${DOT_LABEL[kind]}${i.plannedDepth > 0 && i.plannedDepth < i.idealDepth ? ` (the goal asks depth ${i.idealDepth}, the time allows ${i.plannedDepth})` : ''}${i.sharedWith.length ? `. Shared with ${i.sharedWith.join(', ')}` : ''}`}>
              {i.sharedWith.length > 0 && <span className="shared-mark" aria-hidden="true" />}
            </li>
          );
        })}
      </ul>
      <div className="idea-legend">
        <span>
          <i className="idea-dot is-deep" /> In depth
        </span>
        <span>
          <i className="idea-dot is-overview" /> Overview
        </span>
        <span>
          <i className="idea-dot is-known" /> Already yours
        </span>
        <span>
          <i className="idea-dot is-cut" /> Left out
        </span>
        {ideas.some((i) => i.sharedWith.length > 0) && (
          <span>
            <i className="idea-dot is-overview">
              <span className="shared-mark" />
            </i>{' '}
            Shared with another goal
          </span>
        )}
      </div>
    </div>
  );
}

const DOT_LABEL = { deep: 'learned in depth', overview: 'an overview', known: 'already yours', cut: 'left out for this time' } as const;

/** "About 6 sessions · 14 ideas" and what they are. */
export function planSummary(plan: GoalPlan): { headline: string; detail: string } {
  const inPlan = plan.ideas.total - plan.ideas.cut;
  const sessions = Math.max(plan.sessions, inPlan > plan.ideas.ready ? 1 : 0);
  const headline = `${sessions === 0 ? 'Nothing left to learn' : `About ${sessions} ${sessions === 1 ? 'session' : 'sessions'}`} · ${inPlan} ${inPlan === 1 ? 'idea' : 'ideas'}`;
  const parts = [plan.ideas.deep ? `${plan.ideas.deep} in depth` : '', plan.ideas.overview ? `${plan.ideas.overview} as an overview` : '', plan.ideas.ready ? `${plan.ideas.ready} already yours` : '', plan.ideas.cut ? `${plan.ideas.cut} left out` : ''].filter(Boolean);
  const time = plan.plannedMinutes > 0 ? `, about ${formatHours(plan.plannedMinutes)} of learning` : '';
  return { headline, detail: `${parts.join(', ')}${time}` };
}

/** A plain sentence on pace; null when there is nothing clear to say. */
export function paceSentence(progress: GoalProgress): { text: string; tone: 'calm' | 'warn' | 'good' } | null {
  const { pace } = progress;
  if (pace.kind === 'behind_time') return { text: `You have put in ${formatHours(progress.spentMinutes)} of the ${formatHours(progress.expectedByNow ?? 0)} your rhythm planned by now. Less time means a smaller plan: find a slot this week, or change the time.`, tone: 'warn' };
  if (pace.kind === 'slow') return { text: `Ideas are taking about ${(pace.ratio ?? 2).toFixed(1)}× the planned time. The plan has shrunk to fit; give the goal more time to keep its depth.`, tone: 'warn' };
  if (pace.kind === 'fast') return { text: 'You are learning faster than planned, so the plan grew to use the time.', tone: 'good' };
  if (pace.kind === 'on_track') return { text: 'On track.', tone: 'calm' };
  return null;
}

/** "5 ideas planned shallower to fit your time; about 4 hours more would cover them." */
export function trimSentence(plan: GoalPlan): string | null {
  if (!plan.ideas.trimmed) return null;
  const extra = Math.max(0, plan.fullMinutes - plan.plannedMinutes);
  const n = plan.ideas.trimmed;
  return `${n} ${n === 1 ? 'idea is' : 'ideas are'} planned shallower than the goal asks, to fit your time.${extra >= 15 ? ` About ${formatHours(extra)} more would cover ${n === 1 ? 'it' : 'them'} fully.` : ''}`;
}
