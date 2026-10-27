import { useCallback, useEffect, useState } from 'react';
import type { TodayGoal, TodayView } from '../../backend/api/contract';
import { call, onEvent } from '../api';
import type { ScreenName } from '../components/Shell';
import { Screen } from '../components/Shell';
import { Button, DefGrid, Empty, Meter, MetaLine, Notice, Section } from '../components/controls';
import { Markdown } from '../components/Markdown';
import { ASSESSMENT_LABEL } from './goals/labels';

const MODE_LABEL = { build: 'Build', deepen: 'Deepen', consolidate: 'Consolidate' } as const;

/** Today: what to do now, how each goal stands, what is fading, and the days ahead. */
export function TodayScreen({ onNavigate, onOpenPractice }: { onNavigate: (s: ScreenName) => void; onOpenPractice: (setId: string) => void }) {
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
        <h2 className="t-title">This week</h2>
        <DefGrid
          rows={[
            { label: 'Sessions', value: String(today.week.sessions) },
            { label: 'Ideas practised', value: String(today.week.practised) },
            { label: 'Your pace', value: today.week.minutesTarget ? `${Math.round(today.week.minutesTarget / 60)} hours a week` : 'Not set' },
          ]}
        />
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

      {today.goals.length === 0 && !today.session ? (
        <Empty action={<Button onClick={() => onNavigate('goals')}>Go to goals</Button>}>Add a goal and its material. Today then says what to do each day.</Empty>
      ) : (
        <NextUp today={today} lead={lead} busy={busy} onContinue={() => onNavigate('session')} onStartSession={startSession} onPractice={startPractice} onOpenPractice={onOpenPractice} />
      )}

      {today.fading.length > 0 && (
        <Section title="What is fading" meta={`${today.fading.length} ${today.fading.length === 1 ? 'idea' : 'ideas'}`}>
          <ul className="list-card">
            {today.fading.slice(0, 8).map((f) => (
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
        <Section title="Your goals">
          <ul className="list-card">
            {today.goals.map((g) => (
              <GoalRow key={g.goalId} goal={g} busy={busy} onMock={() => void startPractice(g.goalId, 'mock')} />
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

function GoalRow({ goal, busy, onMock }: { goal: TodayGoal; busy: string | null; onMock: () => void }) {
  const s = goal.schedule;
  const when = s.daysToExam !== null ? (s.daysToExam <= 0 ? 'today' : s.daysToExam === 1 ? 'tomorrow' : `in ${s.daysToExam} days`) : null;
  return (
    <li className="flex flex-col gap-[12px]">
      <div className="row">
        <span className="font-medium">{goal.title}</span>
        <span className="t-small shrink-0 text-muted">
          {goal.ideas.atDepth} of {goal.ideas.total} ideas ready
        </span>
      </div>
      <Meter value={goal.ideas.total ? goal.ideas.atDepth / goal.ideas.total : 0} />
      <MetaLine
        small
        items={[
          goal.assessment !== 'none' ? `${ASSESSMENT_LABEL[goal.assessment]}${when ? ` ${when}` : ''}` : null,
          `${goal.skills.ready} ready`,
          `${goal.skills.learning} learning`,
          `${goal.skills.notStarted} not started`,
          s.due.length ? `${s.due.length} fading` : null,
        ]}
      />
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
