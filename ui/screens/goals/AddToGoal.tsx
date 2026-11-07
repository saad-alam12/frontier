import { plainError } from '../../lib/errors';
import { useEffect, useState } from 'react';
import { call } from '../../api';
import type { AdditionView, Goal } from '../../../backend/api/contract';
import { ADDITION_MAX_CHARS } from '../../../backend/core/types';
import { formatHours } from '../../../backend/core/budget';
import { IdeaField } from '../../components/budget';
import { Button, Notice } from '../../components/controls';
import { Markdown } from '../../components/Markdown';
import { submitOnModEnter } from '../../components/AnswerSurface';
import { plural } from './labels';

/** The one field for adding to a goal, in the hero's place while it is open. */
export function AddComposer({ goalId, onClose, onSent }: { goalId: string; onClose: () => void; onSent: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    void call('goals.additionRequest', { goalId, request: text }).then(onSent, (e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    });
  };
  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-[4px]">
        <h2 className="t-heading">What else do you want to learn here?</h2>
        <p className="t-small m-0 text-secondary">How it connects to a wider field gives a few broad ideas; one part of it gives fewer, deeper ones. You see what it adds before anything changes.</p>
      </div>
      <textarea
        className="goal-sentence learner-text"
        aria-label="What else do you want to learn here?"
        rows={2}
        maxLength={ADDITION_MAX_CHARS}
        value={text}
        autoFocus
        placeholder="A field it connects to, or one part in more depth"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => submitOnModEnter(e, send)}
      />
      {error && <Notice error>{error}</Notice>}
      <div className="button-row">
        <Button kind="primary" disabled={!text.trim() || busy} onClick={send}>
          {busy ? 'Sending…' : 'See what it adds'}
        </Button>
        <Button kind="quiet" onClick={onClose}>
          Cancel
        </Button>
        <span className="keyboard-hint">⌘↵</span>
      </div>
    </div>
  );
}

/** "2 ideas become overviews and 1 is left out": the first part names the ideas, the rest follow it. */
function roomSentence(changes: AdditionView['changes']): string | null {
  const parts = [
    changes.overview.length ? [changes.overview.length, 'becomes an overview', 'become overviews'] : null,
    changes.shallower.length ? [changes.shallower.length, 'is planned less deep', 'are planned less deep'] : null,
    changes.leftOut.length ? [changes.leftOut.length, 'is left out', 'are left out'] : null,
  ].filter((p): p is [number, string, string] => p !== null);
  if (!parts.length) return null;
  const words = parts.map(([n, one, many], i) => `${i === 0 ? plural(n, 'idea') : n} ${n === 1 ? one : many}`);
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : (words[0] ?? null);
}

/** What the addition does to the plan, in one or two plain sentences. */
function PlanChange({ view }: { view: AdditionView }) {
  const changed = [...view.changes.overview, ...view.changes.shallower, ...view.changes.leftOut];
  const room = roomSentence(view.changes);
  const missed = view.changes.missed.length;
  // ideas the goal already had, taken deeper for the request: dots, but not new ideas
  const added = `+${plural(view.joined, 'idea')}${view.deeper > 0 ? `, ${view.deeper} taken deeper` : ''}`;
  if (view.totalMinutes === null) {
    return (
      <div className="flex flex-col gap-[4px]">
        <span className="plan-estimate-number">
          {added} · about +{formatHours(view.addedMinutes)}
        </span>
        <span className="t-small text-secondary">With no time limit the estimate grows; nothing else in your plan changes.</span>
      </div>
    );
  }
  const time = formatHours(view.totalMinutes);
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex flex-col gap-[4px]">
        <span className="plan-estimate-number">
          {added} · your {time} stay
        </span>
        <span className="t-small text-secondary">
          {room ? `To fit them, ${room}.` : 'They fit in the time you have; nothing else changes.'}
          {missed > 0 && ` ${missed === 1 ? '1 of its ideas does' : `${missed} of its ideas do`} not fit your time.`}
        </span>
      </div>
      {changed.length > 0 && (
        <details className="disclosure">
          <summary>Which ideas make room</summary>
          <ul className="addition-changed">
            {view.changes.overview.map((n) => (
              <li key={`o-${n}`}>
                <Markdown text={n} inline /> <span className="text-muted">· overview</span>
              </li>
            ))}
            {view.changes.shallower.map((n) => (
              <li key={`s-${n}`}>
                <Markdown text={n} inline /> <span className="text-muted">· less deep</span>
              </li>
            ))}
            {view.changes.leftOut.map((n) => (
              <li key={`l-${n}`}>
                <Markdown text={n} inline /> <span className="text-muted">· left out</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * Something the learner asked to add, from asking to deciding: worked out in the background (leaving
 * the page does not stop it), then shown with what joins and what it does to the plan. A request that
 * reads like a goal of its own says so and offers to make it one.
 */
export function AdditionPanel({ goal, onChanged, onNewGoal }: { goal: Goal; onChanged: () => void; onNewGoal: (text: string) => void }) {
  const addition = goal.addition;
  const [view, setView] = useState<AdditionView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readyAt = addition?.state === 'ready' ? addition.at : null;
  useEffect(() => {
    if (!readyAt) return;
    let live = true;
    void call('goals.additionView', { goalId: goal.id }).then((v) => live && setView(v));
    return () => {
      live = false;
    };
  }, [goal.id, readyAt]);
  if (!addition) return null;

  const act = (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    void fn()
      .then(onChanged, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  };
  const cancel = () => act('cancel', () => call('goals.additionDismiss', { goalId: goal.id }));
  const head = (
    <div className="flex flex-col gap-[8px]">
      <div className="t-caption text-accent-text">Adding to this goal</div>
      <p className="t-lead m-0">“{addition.request}”</p>
    </div>
  );

  if (addition.state === 'requested') {
    return (
      <section className="addition-panel" aria-label="Adding to this goal" aria-busy="true">
        {head}
        <div className="addition-wait" role="status">
          <span className="idea-field is-loading" aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} className="idea-dot is-cut" style={{ animationDelay: `${i * 90}ms` }} />
            ))}
          </span>
          <span className="t-small flex-1 text-secondary">Working out what it adds. You can leave and come back.</span>
          <Button kind="quiet" disabled={busy !== null} onClick={cancel}>
            Cancel
          </Button>
        </div>
      </section>
    );
  }

  if (addition.state === 'failed') {
    return (
      <section className="addition-panel" aria-label="Adding to this goal">
        {head}
        <Notice error detail={addition.message}>
          Working it out failed. {plainError(addition.message)}
        </Notice>
        <div className="button-row">
          <Button disabled={busy !== null} onClick={() => act('retry', () => call('goals.additionRequest', { goalId: goal.id, request: addition.request }))}>
            Try again
          </Button>
          <Button kind="quiet" disabled={busy !== null} onClick={cancel}>
            Cancel
          </Button>
        </div>
      </section>
    );
  }

  if (!view) return null;
  const add = (label: string) => act(label, () => call('goals.additionApprove', { goalId: goal.id }));
  return (
    <section className="addition-panel" aria-label="Adding to this goal">
      {head}
      {!view.fits && view.reason && (
        <p className="addition-misfit m-0">{view.reason}</p>
      )}
      <div className="flex flex-col gap-[12px]">
        <div className="t-small text-secondary">{view.shape === 'broad' ? 'A broad addition: how it connects, in a few overview ideas.' : 'A focused addition: one part, in more depth.'}</div>
        <ul className="addition-skills">
          {view.skills.map((s) => (
            <li key={s}>
              <Markdown text={s} inline />
            </li>
          ))}
        </ul>
        <IdeaField ideas={view.ideas} noLimit={view.totalMinutes === null} />
      </div>
      <PlanChange view={view} />
      {error && <Notice error>{error}</Notice>}
      <div className="button-row">
        {view.fits ? (
          <Button kind="primary" disabled={busy !== null} onClick={() => add('add')}>
            {busy === 'add' ? 'Adding…' : 'Add'}
          </Button>
        ) : (
          <>
            <Button
              kind="primary"
              disabled={busy !== null}
              onClick={() =>
                act('new', async () => {
                  await call('goals.additionDismiss', { goalId: goal.id });
                  onNewGoal(addition.request);
                })
              }
            >
              Make it a new goal
            </Button>
            <Button disabled={busy !== null} onClick={() => add('add')}>
              {busy === 'add' ? 'Adding…' : 'Add it anyway'}
            </Button>
          </>
        )}
        <Button kind="quiet" disabled={busy !== null} onClick={cancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
