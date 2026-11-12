/** What a goal's page says about work on the goal: mapping in progress or failed, a new map to approve. */
import { plainError } from '../../lib/errors';
import { useEffect, useState } from 'react';
import { call } from '../../api';
import type { GoalDetail, RemapView } from '../../../backend/api/contract';
import { formatHours } from '../../../backend/core/budget';
import { IdeaField, planSummary } from '../../components/budget';
import { Button, DefGrid, Notice } from '../../components/controls';
import { LEVEL_LABEL, capitalize } from './labels';

/**
 * A new map proposed for what the learner's answers showed (or that they asked for), next to the plan
 * they have: same time, how many sessions and ideas each gives, the new map's dots. Nothing changes
 * until they choose it.
 */
export function RemapPanel({ goalId, caption, onChanged }: { goalId: string; caption: string; onChanged: () => void }) {
  const [view, setView] = useState<RemapView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    let live = true;
    void call('goals.remapView', { goalId }).then((v) => live && setView(v));
    return () => {
      live = false;
    };
  }, [goalId]);
  if (!view) return null;
  const choose = (label: string, method: 'goals.remapApprove' | 'goals.remapDismiss') => {
    setBusy(label);
    void call(method, { goalId })
      .then(onChanged)
      .finally(() => setBusy(null));
  };
  const startBackground = (goal: NonNullable<RemapView['backgroundGoal']>) => {
    setBusy('background');
    void call('goals.create', { form: { text: goal.text, kind: 'personal', assessment: 'none', budget: { mode: 'total', hours: goal.hours }, focus: [], materials: [] }, draft: true })
      .then(() => setStarted(true))
      .finally(() => setBusy(null));
  };
  const now = view.before ? planSummary(view.before.plan).headline : null;
  const next = view.after ? planSummary(view.after.plan) : null;
  return (
    <section className="remap-panel" aria-label="A new map">
      <div className="flex flex-col gap-[8px]">
        <div className="t-caption text-accent-text">{caption}</div>
        <p className="t-lead m-0">{view.reason}</p>
      </div>
      <DefGrid
        rows={[
          ...(now ? [{ label: 'Your map', value: now }] : []),
          ...(next ? [{ label: 'The new map', value: `${next.headline}. ${capitalize(next.detail)}.` }] : []),
        ]}
      />
      <div className="scope-note">
        <div className="t-caption text-muted">{LEVEL_LABEL[view.level]}</div>
        <p className="m-0">{view.scope}</p>
      </div>
      {view.after && <IdeaField ideas={view.after.ideas} />}
      <div className="button-row">
        <Button kind="primary" disabled={busy !== null} onClick={() => choose('approve', 'goals.remapApprove')}>
          {busy === 'approve' ? 'Switching…' : 'Use the new map'}
        </Button>
        <Button kind="quiet" disabled={busy !== null} onClick={() => choose('dismiss', 'goals.remapDismiss')}>
          Keep my map
        </Button>
      </div>
      {view.backgroundGoal && (
        <div className="background-goal">
          {started ? (
            <span className="t-small text-secondary">Started as a new goal. Its plan will be ready under Goals in a minute or two.</span>
          ) : (
            <>
              <span className="t-small text-secondary">
                The missing background is a goal of its own: “{view.backgroundGoal.text}”, about {formatHours(view.backgroundGoal.hours * 60)}.
              </span>
              <Button kind="quiet" disabled={busy !== null} onClick={() => view.backgroundGoal && startBackground(view.backgroundGoal)}>
                Start it as a goal
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function WorkNotice({ detail, onRetry }: { detail: GoalDetail; onRetry: () => void }) {
  const { work } = detail;
  // an addition being worked out shows on its own panel
  if (work.state === 'idle' || work.state === 'adding') return null;
  if (work.state === 'failed')
    return (
      <div className="button-row">
        <Notice error detail={work.message}>
          Mapping the goal failed. {plainError(work.message)}
        </Notice>
        <Button kind="quiet" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  const reading = detail.materials.filter((m) => m.role === 'teaching' || m.role === 'reference');
  const done = reading.reduce((n, m) => n + m.chunksDone, 0);
  const total = reading.reduce((n, m) => n + m.chunkCount, 0);
  return (
    <div className="work-notice" role="status">
      <span className="dot is-current" aria-hidden="true" />
      <span>{work.state === 'reading' && total ? `${work.message}: ${done} of ${total} parts` : work.message}</span>
    </div>
  );
}
