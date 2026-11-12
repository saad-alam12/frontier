import { useEffect, useState } from 'react';
import type { WeekReviewView } from '../../backend/api/contract';
import { formatHours } from '../../backend/core/budget';
import { call } from '../api';
import { Button } from './controls';
import { Markdown } from './Markdown';

export interface WeekActions {
  onOpenGoal: (goalId: string) => void;
  onTestMe: (nodeIds: string[]) => void;
  onToday: () => void;
}

/** Shift a local YYYY-MM-DD date by whole days. */
function shift(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function weekLabel(view: WeekReviewView): string {
  const a = new Date(`${view.start}T12:00:00`);
  const b = new Date(`${view.end}T12:00:00`);
  const sameMonth = a.getMonth() === b.getMonth();
  const from = a.toLocaleDateString('en-GB', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'long' });
  return `${from} to ${b.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
}

/**
 * Your week (design §10): one page per week with what was learned, what faded, where you were too
 * sure, and one change worth making, with the button that makes it.
 */
export function WeekReview({ actions }: { actions: WeekActions }) {
  const [weekOf, setWeekOf] = useState<string | null>(null);
  const [view, setView] = useState<WeekReviewView | null>(null);
  useEffect(() => {
    let live = true;
    void call('stats.week', { weekOf }).then((v) => live && setView(v));
    return () => {
      live = false;
    };
  }, [weekOf]);
  if (!view) return null;

  const s = view.suggestion;
  const action =
    (s.kind === 'catchUp' || s.kind === 'useTime') && s.goalId ? (
      <Button onClick={() => actions.onOpenGoal(s.goalId ?? '')}>Open the goal</Button>
    ) : s.kind === 'checkFirst' ? (
      <Button onClick={() => actions.onTestMe(s.nodeIds)}>Test me on these</Button>
    ) : s.kind === 'practise' || s.kind === 'start' ? (
      <Button onClick={actions.onToday}>Go to Today</Button>
    ) : null;

  const totals = [view.minutes ? formatHours(view.minutes) : 'No time', `${view.sessions} ${view.sessions === 1 ? 'session' : 'sessions'}`, `${view.answers} ${view.answers === 1 ? 'answer' : 'answers'}`, `${view.cardsReviewed} ${view.cardsReviewed === 1 ? 'flashcard' : 'flashcards'} reviewed`];
  return (
    <div className="week-review">
      <div className="week-nav">
        <Button kind="quiet" onClick={() => setWeekOf(shift(view.start, -7))} disabled={!view.hasEarlier}>
          Earlier week
        </Button>
        <div className="flex flex-col items-center gap-[2px]">
          <h2 className="t-title m-0">{view.current ? 'This week' : weekLabel(view)}</h2>
          {view.current && <span className="t-small text-muted">{weekLabel(view)}, so far</span>}
        </div>
        <Button kind="quiet" onClick={() => setWeekOf(view.current ? null : shift(view.start, 7))} disabled={view.current}>
          Later week
        </Button>
      </div>
      <p className="m-0 text-secondary week-totals">{totals.join(' · ')}</p>

      <section className="week-change" aria-label="One change">
        <div className="label">{view.current ? 'One change for the rest of the week' : 'One change worth making'}</div>
        <p className="m-0 t-lead">{s.text}</p>
        {action && <div className="button-row">{action}</div>}
      </section>

      <div className="week-parts">
        <WeekPart title="What you learned" empty="No idea reached a new depth this week." more={view.learnedCount - view.learned.length}>
          {view.learned.map((l) => (
            <li key={l.nodeId}>
              <Markdown text={l.name} inline />
              <span className="text-muted">{l.reached}</span>
            </li>
          ))}
        </WeekPart>
        <WeekPart title="What faded" empty="Nothing you learned dropped below 70% recall." more={view.fadedCount - view.faded.length}>
          {view.faded.map((f) => (
            <li key={f.nodeId}>
              <Markdown text={f.name} inline />
              <span className="text-muted">{Math.round(f.recall * 100)}% recall</span>
            </li>
          ))}
        </WeekPart>
        <WeekPart title="Where you were too sure" empty={view.sure.answers ? 'Every answer you were sure of held up.' : 'No answer this week was given as fairly sure or sure.'} more={0}>
          {view.tooSure.map((t) => (
            <li key={t.nodeId}>
              <Markdown text={t.name} inline />
              <span className="text-muted">{t.count === 1 ? 'once' : `${t.count} times`}</span>
            </li>
          ))}
        </WeekPart>
      </div>
      {view.sure.answers > 0 && (
        <p className="t-small m-0 text-muted">
          Of {view.sure.answers} {view.sure.answers === 1 ? 'answer' : 'answers'} you gave as fairly sure or sure, {view.sure.right} {view.sure.right === 1 ? 'was' : 'were'} right.
        </p>
      )}
    </div>
  );
}

function WeekPart({ title, empty, more, children }: { title: string; empty: string; more: number; children: React.ReactNode[] }) {
  return (
    <section className="week-part">
      <h3 className="panel-label m-0">{title}</h3>
      {children.length === 0 ? (
        <p className="t-small m-0 text-muted">{empty}</p>
      ) : (
        <ul className="week-list">
          {children}
          {more > 0 && <li className="text-muted">and {more} more</li>}
        </ul>
      )}
    </section>
  );
}
