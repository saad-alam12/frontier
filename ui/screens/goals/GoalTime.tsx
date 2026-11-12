/** A goal's time on its page: the figures, notes on the pace, and the editor for the time. */
import { useEffect, useState } from 'react';
import { call } from '../../api';
import type { GoalBudget, GoalDetail, GoalLevel, GoalProgress, PlanPreview } from '../../../backend/api/contract';
import { formatHours } from '../../../backend/core/budget';
import { IdeaField, estimateLine, paceSentence, planSummary, trimSentence } from '../../components/budget';
import { TimeChoice } from '../../components/TimeChoice';
import { Button } from '../../components/controls';
import { defaultBudget, weeksUntil } from '../../lib/budgetDefaults';

/**
 * Ideas ready against the plan, time against the budget, and this week against the rhythm. With no
 * time limit: the time studied and the estimate of what is left.
 */
export function ProgressFigures({ progress }: { progress: GoalProgress }) {
  const { plan } = progress;
  const inPlan = plan.ideas.total - plan.ideas.cut;
  return (
    <div className="figures">
      <div className="figure">
        <span className="figure-number">
          {plan.ideas.ready}
          <span className="figure-of"> / {inPlan}</span>
        </span>
        <span className="figure-label">ideas ready</span>
      </div>
      <div className="figure">
        <span className="figure-number">
          {formatHours(progress.spentMinutes)}
          {progress.totalMinutes !== null && <span className="figure-of"> / {formatHours(progress.totalMinutes)}</span>}
        </span>
        <span className="figure-label">{progress.budget ? 'of your time' : 'studied'}</span>
      </div>
      {progress.noLimit && (
        <div className="figure">
          <span className="figure-number">
            <span className="figure-of">about </span>
            {formatHours(plan.plannedMinutes)}
          </span>
          <span className="figure-label">left, estimated</span>
        </div>
      )}
      {progress.weeklyTarget !== null && (
        <div className="figure">
          <span className="figure-number">
            {formatHours(progress.weekMinutes)}
            <span className="figure-of"> / {formatHours(progress.weeklyTarget)}</span>
          </span>
          <span className="figure-label">this week</span>
        </div>
      )}
      <div className="figure">
        <span className="figure-number">{plan.sessions}</span>
        <span className="figure-label">{plan.sessions === 1 ? 'session left' : 'sessions left'}</span>
      </div>
    </div>
  );
}

export function PaceNotes({ progress }: { progress: GoalProgress }) {
  const pace = paceSentence(progress);
  const trim = trimSentence(progress.plan);
  if (progress.noLimit) return null;
  if (!progress.budget) return <p className="t-small m-0 text-secondary">Give the goal a time and the plan is sized to it: the most useful ideas first.</p>;
  if (!pace && !trim) return null;
  return (
    <div className="pace-notes">
      {pace && <p className={`m-0 pace-${pace.tone}`}>{pace.text}</p>}
      {trim && <p className="t-small m-0 text-secondary">{trim}</p>}
    </div>
  );
}

/** "Your time now holds 4 more ideas and 2 in more depth: about 3 hours of it are not planned." */
export function roomSentence(room: NonNullable<GoalProgress['room']>): string {
  const parts = [room.more ? `${room.more} more ${room.more === 1 ? 'idea' : 'ideas'}` : null, room.deeper ? `${room.deeper} in more depth` : null].filter(Boolean);
  return `Your time now holds ${parts.join(' and ')}: about ${formatHours(room.minutes)} of it are not planned, because you knew or learned some of the plan faster than expected.`;
}

/**
 * Change the time, or switch between a time and no time limit, with the plan re-computed live, then
 * save. A new amount of time re-plans the same map; a new depth or a switch asks for a new map.
 */
export function TimeEditor({ detail, onClose, onSaved }: { detail: GoalDetail; onClose: () => void; onSaved: () => void }) {
  const { goal } = detail;
  const [budget, setBudget] = useState<GoalBudget>(goal.budget ?? defaultBudget(goal.kind, goal.date));
  const [limited, setLimited] = useState(goal.wantedLevel === null);
  const [level, setLevel] = useState<GoalLevel>(goal.wantedLevel ?? goal.level ?? 'working');
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [saving, setSaving] = useState(false);
  const teaching = detail.materials.filter((m) => m.role === 'teaching').length;
  const planned = limited ? budget : null;
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => void call('goals.preview', { goalId: goal.id, budget: planned }).then((p) => live && setPreview(p)), 120);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [goal.id, planned]);
  const summary = preview ? planSummary(preview.plan, { noLimit: !limited }) : null;
  const wanted = limited ? null : level;
  // the map was drawn for a time or for a depth: changing which (or the depth) draws a new one to approve
  const remaps = wanted !== goal.wantedLevel;
  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-[4px]">
        <h2 className="t-heading">{limited ? 'How much time do you give it?' : 'How deep do you want to go?'}</h2>
        <p className="t-small m-0 text-secondary">
          {remaps
            ? limited
              ? 'The plan fits this time when you save, and a new map sized to it is drawn for you to approve.'
              : 'Saving draws a new map for this depth for you to approve. Your map stays until you choose.'
            : limited
              ? 'The plan keeps what you know and re-spends the time that is left, most useful ideas first.'
              : 'The plan holds every idea at its full depth. Changing the depth draws a new map for you to approve.'}
        </p>
      </div>
      <TimeChoice
        limited={limited}
        onLimited={setLimited}
        budget={budget}
        onBudget={setBudget}
        level={level}
        onLevel={setLevel}
        resources={teaching}
        allowPerResource={goal.kind === 'course' || teaching > 0}
        defaultWeeks={weeksUntil(goal.date)}
      />
      {summary && preview && (
        <div className="flex flex-col gap-[12px]">
          <div>
            <span className="font-medium">{limited ? summary.headline : estimateLine(preview.plan)}</span> <span className="text-secondary">· {summary.detail}</span>
          </div>
          <IdeaField ideas={preview.ideas} noLimit={!limited} />
        </div>
      )}
      <div className="button-row">
        <Button
          kind="primary"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            void call('goals.update', { goalId: goal.id, form: { budget: planned, wantedLevel: wanted } }).then(onSaved, () => setSaving(false));
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button kind="quiet" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
