import { useCallback, useEffect, useState } from 'react';
import type { TodayGoal, TodayView } from '../../backend/api/contract';
import { call, onEvent } from '../api';
import type { ScreenName } from '../components/Shell';
import { Screen } from '../components/Shell';
import { Button, Meter, MetaLine, Notice, Section } from '../components/controls';
import { Markdown } from '../components/Markdown';
import { BudgetBar, paceSentence } from '../components/budget';
import { formatHours } from '../../backend/core/budget';
import { ASSESSMENT_LABEL } from './goals/labels';
import type { GoalsView } from './GoalsScreen';

const MODE_LABEL = { build: 'Build', deepen: 'Deepen', consolidate: 'Consolidate' } as const;

/** Today: what to do now, how each goal stands, what is fading, and the days ahead. */
export function TodayScreen({ onNavigate, onOpenGoals, onOpenPractice }: { onNavigate: (s: ScreenName) => void; onOpenGoals: (view: GoalsView) => void; onOpenPractice: (setId: string) => void }) {
  const [showAllFading, setShowAllFading] = useState(false);
  const [today, setToday] = useState<TodayView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => setToday(await call('today.view')), []);
  useEffect(() => {
    void refresh();
    const offs = [onEvent('practice.graded', () => void refresh()), onEvent('goals.changed', () => void refresh())];
    return () => offs.forEach((off) => off());
  }, [refresh]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const startSession = (goalId: string) =>
    run(`session:${goalId}`, async () => {
      await call('session.start', { goalId });
      onNavigate('session');
    });
  const startPractice = (goalId: string, kind: 'compound' | 'mock') =>
    run(`${kind}:${goalId}`, async () => {
      const set = await call('practice.start', { goalId, kind });
      if (set) onOpenPractice(set.id);
      else setError('Nothing is fading right now. Practice opens again when ideas start to slip.');
    });

  if (!today) return <Screen>{null}</Screen>;
  if (!today.anyGoals) return <Welcome onStart={() => onOpenGoals({ name: 'new' })} />;

  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const lead = today.goals[0];
  const mostFading = [...today.goals].sort((a, b) => b.schedule.due.length - a.schedule.due.length)[0];

  const aside = (
    <>
      {today.preview && (
        <div className="flex flex-col gap-[14px]">
          <h2 className="t-title">Today opens with</h2>
          <Markdown text={today.preview.question} className="t-lead" />
          <p className="t-small m-0 text-muted">From your session on {formatDay(today.preview.date)}. Think about it before you start.</p>
        </div>
      )}
      {today.preview && <div className="divider" />}
      <div className="flex flex-col gap-[14px]">
        <div className="section-head">
          <h2 className="t-title">The next two weeks</h2>
          <span className="t-caption text-secondary">ideas falling due</span>
        </div>
        <Forecast counts={today.forecast} />
      </div>
      <div className="divider" />
      <div className="flex flex-col gap-[14px]">
        <div className="section-head">
          <h2 className="t-title">The last seven days</h2>
          <button type="button" className="link-button" onClick={() => onNavigate('stats')}>
            All stats
          </button>
        </div>
        <div className="week-figure">
          <span className="figure-number">
            {formatHours(today.week.minutesStudied)}
            {today.week.minutesTarget > 0 && <span className="figure-of"> / {formatHours(today.week.minutesTarget)}</span>}
          </span>
          <span className="figure-label">{today.week.minutesTarget > 0 ? 'of the week your goals ask for' : 'studied'}</span>
          {today.week.minutesTarget > 0 && <Meter value={today.week.minutesStudied / today.week.minutesTarget} accent />}
        </div>
        <MetaLine small items={[`${today.week.sessions} ${today.week.sessions === 1 ? 'session' : 'sessions'}`, `${today.week.practised} ${today.week.practised === 1 ? 'idea' : 'ideas'} practised`]} />
      </div>
    </>
  );

  return (
    <Screen aside={aside} asideLabel="The days ahead">
      <div className="flex flex-col gap-[14px]">
        <div className="t-caption text-muted">{date}</div>
        <h1 className="t-display">Today</h1>
      </div>
      {error && <Notice error>{error}</Notice>}

      <NextUp today={today} lead={lead} busy={busy} onContinue={() => onNavigate('session')} onStartSession={startSession} onPractice={startPractice} onOpenPractice={onOpenPractice} />
      {today.drafts.map((d) => (
        <div key={d.goalId} className="next-card is-quiet">
          <div className="mode">
            <span className="mode-dot" aria-hidden="true" />
            {d.mapped ? 'Plan ready' : 'Being mapped'}
          </div>
          <span className="t-heading">{d.title}</span>
          <p className="t-lead m-0">{d.mapped ? 'Its plan is ready. Look it over, adjust the time if you like, and start.' : 'Frontier is mapping it now. The plan will be ready in a minute or two.'}</p>
          <div className="button-row">
            <Button kind={today.goals.length ? 'secondary' : 'primary'} onClick={() => onOpenGoals({ name: 'draft', goalId: d.goalId })}>
              {d.mapped ? 'Review the plan' : 'See progress'}
            </Button>
          </div>
        </div>
      ))}

      {today.remaps.map((r) => (
        <div key={r.goalId} className="next-card is-quiet">
          <div className="mode">
            <span className="mode-dot" aria-hidden="true" />A new map
          </div>
          <span className="t-heading">{r.title}</span>
          <p className="t-lead m-0">{r.reason}</p>
          <div className="button-row">
            <Button onClick={() => onOpenGoals({ name: 'goal', goalId: r.goalId })}>Look at it</Button>
          </div>
        </div>
      ))}

      {today.fading.length > 0 && (
        <Section title="What is fading" meta={`${today.fading.length} ${today.fading.length === 1 ? 'idea' : 'ideas'}`}>
          <ul className="list-card">
            {today.fading.slice(0, showAllFading ? 30 : 3).map((f) => (
              <li key={f.nodeId} className="fading-row">
                <div className="flex min-w-0 flex-col">
                  <Markdown text={f.name} inline />
                  <span className="t-small text-muted">{f.reason === 'exam' ? `Would be at ${Math.round((f.recallAtExam ?? 0) * 100)}% on the exam day` : f.goalTitle}</span>
                </div>
                <Meter value={f.recall} accent />
                <span className="recall-pct">{Math.round(f.recall * 100)}%</span>
              </li>
            ))}
          </ul>
          {today.fading.length > 3 && (
            <button type="button" className="link-button" onClick={() => setShowAllFading(!showAllFading)}>
              {showAllFading ? 'Fewer' : `Show all ${today.fading.length}`}
            </button>
          )}
          {mostFading && mostFading.schedule.due.length > 0 && !today.practice && (
            <div className="button-row">
              <Button onClick={() => void startPractice(mostFading.goalId, 'compound')} disabled={busy !== null}>
                {busy === `compound:${mostFading.goalId}` ? 'Writing problems…' : 'Practise these together'}
              </Button>
              <span className="t-small text-muted">A few problems, each needing several of them at once.</span>
            </div>
          )}
        </Section>
      )}

      {today.goals.length > 0 && (
        <Section
          title="Your goals"
          meta={
            <button type="button" className="link-button" onClick={() => onOpenGoals({ name: 'new' })}>
              New goal
            </button>
          }
        >
          <ul className="goal-cards">
            {today.goals.map((g) => (
              <GoalRow key={g.goalId} goal={g} busy={busy} onOpen={() => onOpenGoals({ name: 'goal', goalId: g.goalId })} onMock={() => void startPractice(g.goalId, 'mock')} />
            ))}
          </ul>
        </Section>
      )}
    </Screen>
  );
}

function NextUp({
  today,
  lead,
  busy,
  onContinue,
  onStartSession,
  onPractice,
  onOpenPractice,
}: {
  today: TodayView;
  lead: TodayGoal | undefined;
  busy: string | null;
  onContinue: () => void;
  onStartSession: (goalId: string) => void;
  onPractice: (goalId: string, kind: 'compound' | 'mock') => void;
  onOpenPractice: (setId: string) => void;
}) {
  if (today.session) {
    return (
      <div className="next-card">
        <div className="mode">
          <span className="mode-dot" aria-hidden="true" />
          In progress
        </div>
        <div className="flex flex-col gap-[6px]">
          <span className="t-heading">{today.session.planTitle}</span>
          <MetaLine small items={[today.session.goalTitle, <Markdown key="w" text={today.session.where} inline />]} />
        </div>
        <div className="button-row">
          <Button kind="primary" onClick={onContinue}>
            Continue session
          </Button>
        </div>
      </div>
    );
  }
  if (today.practice) {
    const left = today.practice.problems.filter((p) => p.answer === null).length;
    return (
      <div className="next-card">
        <div className="mode">
          <span className="mode-dot" aria-hidden="true" />
          {today.practice.kind === 'mock' ? 'Mock exam' : 'Practice'} in progress
        </div>
        <span className="t-heading">
          {left} of {today.practice.problems.length} problems left
        </span>
        <div className="button-row">
          <Button kind="primary" onClick={() => onOpenPractice(today.practice?.id ?? '')}>
            Continue practice
          </Button>
        </div>
      </div>
    );
  }
  if (!lead) return null;
  const s = lead.schedule;
  const practiseFirst = s.mode === 'consolidate';
  return (
    <div className="next-card">
      <div className="mode">
        <span className="mode-dot" aria-hidden="true" />
        {MODE_LABEL[s.mode]} · about {s.dailyMinutes} minutes
      </div>
      <div className="flex flex-col gap-[6px]">
        <span className="t-heading">{lead.title}</span>
        <p className="t-lead m-0">{s.modeReason}</p>
      </div>
      <div className="button-row">
        {practiseFirst ? (
          <>
            <Button kind="primary" onClick={() => onPractice(lead.goalId, 'compound')} disabled={busy !== null}>
              {busy === `compound:${lead.goalId}` ? 'Writing problems…' : 'Practise what is fading'}
            </Button>
            <Button onClick={() => onStartSession(lead.goalId)} disabled={busy !== null}>
              {busy === `session:${lead.goalId}` ? 'Planning…' : 'Start a session instead'}
            </Button>
          </>
        ) : (
          <Button kind="primary" onClick={() => onStartSession(lead.goalId)} disabled={busy !== null}>
            {busy === `session:${lead.goalId}` ? 'Planning…' : "Start today's session"}
          </Button>
        )}
      </div>
    </div>
  );
}

function GoalRow({ goal, busy, onOpen, onMock }: { goal: TodayGoal; busy: string | null; onOpen: () => void; onMock: () => void }) {
  const s = goal.schedule;
  const p = goal.progress;
  const when = s.daysToExam !== null ? (s.daysToExam <= 0 ? 'today' : s.daysToExam === 1 ? 'tomorrow' : `in ${s.daysToExam} days`) : null;
  const pace = p ? paceSentence(p) : null;
  const inPlan = p ? p.plan.ideas.total - p.plan.ideas.cut : goal.ideas.total;
  return (
    <li className="flex flex-col gap-[10px]">
      <button type="button" className="goal-card" onClick={onOpen}>
        <span className="flex items-baseline justify-between gap-[16px]">
          <span className="text-[17px] font-medium">{goal.title}</span>
          <span className="t-small shrink-0 text-muted">
            {p ? p.plan.ideas.ready : goal.ideas.atDepth} of {inPlan} ideas ready
          </span>
        </span>
        {p && <BudgetBar compact progress={{ ...p, plannedMinutes: p.plan.plannedMinutes }} />}
        <MetaLine
          small
          items={[
            goal.assessment !== 'none' ? `${ASSESSMENT_LABEL[goal.assessment]}${when ? ` ${when}` : ''}` : null,
            p ? `${formatHours(p.spentMinutes)}${p.totalMinutes ? ` of ${formatHours(p.totalMinutes)}` : ''}` : null,
            p && p.weeklyTarget ? `${formatHours(p.weekMinutes)} of ${formatHours(p.weeklyTarget)} this week` : null,
            s.due.length ? `${s.due.length} fading` : null,
            pace && pace.tone !== 'calm' ? <span className={`pace-${pace.tone}`}>{pace.tone === 'warn' ? 'Needs attention' : 'Ahead'}</span> : null,
          ]}
        />
      </button>
      {s.mockOpen && (
        <div className="button-row">
          <Button onClick={onMock} disabled={busy !== null}>
            {busy === `mock:${goal.goalId}` ? 'Writing the exam…' : 'Take a mock exam'}
          </Button>
          <span className="t-small text-muted">Five problems the way your exam asks them.</span>
        </div>
      )}
    </li>
  );
}

/** The first screen of an empty app: what Frontier does in three steps, and one thing to do. */
function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <Screen>
      <div className="welcome">
        <div className="welcome-mark" aria-hidden="true">
          <span />
        </div>
        <h1 className="welcome-title">Learn what matters, in the time you have.</h1>
        <p className="t-lead m-0 max-w-[560px]">
          Tell Frontier what you want to learn and how much time you can give it. It maps the ideas, finds where you stand, and teaches at the edge of what you know, the most useful ideas first.
        </p>
        <ol className="welcome-steps">
          <li>
            <span className="welcome-step-n">1</span>
            <span className="font-medium">Say what you want</span>
            <span className="t-small text-secondary">A course to pass, a book to work through, a paper to understand.</span>
          </li>
          <li>
            <span className="welcome-step-n">2</span>
            <span className="font-medium">Give it time</span>
            <span className="t-small text-secondary">Two hours or a semester. The time decides how deep the plan goes.</span>
          </li>
          <li>
            <span className="welcome-step-n">3</span>
            <span className="font-medium">Learn at your edge</span>
            <span className="t-small text-secondary">Short sessions that build on what you know, and practice that keeps it.</span>
          </li>
        </ol>
        <div className="button-row">
          <button type="button" className="btn btn-primary btn-large" onClick={onStart}>
            Set your first goal
          </button>
        </div>
      </div>
    </Screen>
  );
}

/** Fourteen bars, today in the accent; heights relative to the busiest day. */
function Forecast({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  return (
    <div className="forecast" role="img" aria-label={`Ideas falling due over the next two weeks: ${counts.join(', ')}`}>
      <div className="forecast-bars" aria-hidden="true">
        {counts.map((n, i) => (
          <span key={i} className={i === 0 ? 'is-today' : undefined} style={{ height: `${Math.max(3, (n / max) * 100)}%`, opacity: n === 0 ? 0.5 : 1 }} title={`${n}`} />
        ))}
      </div>
      <div className="forecast-axis" aria-hidden="true">
        <span>Today</span>
        <span>{total === 0 ? 'Nothing due' : `${total} in all`}</span>
        <span>In two weeks</span>
      </div>
    </div>
  );
}

function formatDay(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}
