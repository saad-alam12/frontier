import { useEffect, useState } from 'react';
import { call } from '../../api';
import type { GoalDetail, MaterialRole, MaterialView, ProbeAnswerInput, ProbeOutcome, ProbeView } from '../../../backend/api/contract';
import { Breadcrumb, Screen } from '../../components/Shell';
import { Button, DefGrid, Meter, MetaLine, Notice, Section } from '../../components/controls';
import { Markdown } from '../../components/Markdown';
import { VerticalPath } from '../../components/paths';
import type { PointState } from '../../components/paths';
import { ProbeFlow, ProbeResults } from '../../components/ProbeFlow';
import { ASSESSMENT_LABEL, ROLE_OPTIONS, SKILL_LABEL, SKILL_TONE, dateLabel, formatDate, goalName, isExam, plural, weeksUntil } from './labels';

const SKILLS_SHOWN = 6;
/** A lecture counts as done once this share of its ideas is yours. */
const LECTURE_DONE = 0.8;

const ROLE_PLURAL: Record<MaterialRole, string> = { teaching: 'Teaching content', practice: 'Practice', assessment: 'Past exams', scope: 'Scope', reference: 'Reference' };

/** A goal's page (docs/mockups/GoalPage.dc.html). */
export function GoalPage({ detail, onBack, onEdit, onStartSession, onChanged }: { detail: GoalDetail; onBack: () => void; onEdit: () => void; onStartSession: () => Promise<void>; onChanged: () => void }) {
  const { goal } = detail;
  const [probe, setProbe] = useState<ProbeView | null>(null);
  const [outcomes, setOutcomes] = useState<ProbeOutcome[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allSkills, setAllSkills] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void call('probe.open', { goalId: goal.id }).then((open) => !cancelled && setProbe(open));
    return () => {
      cancelled = true;
    };
  }, [goal.id]);

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

  const course = goal.kind === 'course';
  const teaching = detail.materials.filter((m) => m.role === 'teaching');
  const weeks = weeksUntil(goal.date);
  const dateName = dateLabel(goal.assessment);
  const compiled = detail.capabilities.length > 0;
  const skills = allSkills ? detail.capabilities : detail.capabilities.slice(0, SKILLS_SHOWN);

  const aside = (
    <>
      <div className="flex flex-col gap-[16px]">
        <h2 className="t-title">This week</h2>
        {detail.nextIdeas.length > 0 ? (
          <div className="this-week">
            <span className="text-text">Today</span>
            <Markdown text={detail.nextIdeas.join(', then ')} inline />
          </div>
        ) : (
          <p className="m-0 text-secondary">{compiled ? 'Nothing new is learnable right now.' : 'Your plan appears once your material is mapped.'}</p>
        )}
        <div className="button-row">
          <Button kind="primary" onClick={() => void run('session', onStartSession)} disabled={!compiled || busy !== null}>
            {busy === 'session' ? 'Planning…' : "Start today's session"}
          </Button>
        </div>
      </div>

      {goal.examProfile && (
        <>
          <div className="divider" />
          <div className="flex flex-col gap-[10px]">
            <div className="panel-label">Exam style, from {detail.materials.filter((m) => m.role === 'assessment').map((m) => m.title).join(', ')}</div>
            <div className="t-lead">{goal.examProfile.summary}</div>
          </div>
        </>
      )}

      <div className="divider" />
      <div className="flex flex-col gap-[14px]">
        <div className="section-head">
          <div className="panel-label">Material</div>
          <button type="button" className="link-button" onClick={onEdit}>
            Add material
          </button>
        </div>
        {detail.materials.length ? (
          <DefGrid
            wide
            rows={ROLE_OPTIONS.filter((o) => detail.materials.some((m) => m.role === o.value)).map((o) => ({
              label: ROLE_PLURAL[o.value],
              value: detail.materials
                .filter((m) => m.role === o.value)
                .map((m) => m.title)
                .join(', '),
            }))}
          />
        ) : (
          <p className="m-0 text-secondary">None. The roadmap comes from your goal and what the questions show.</p>
        )}
      </div>
    </>
  );

  return (
    <Screen aside={aside} asideLabel="Plan and material">
      <div className="section-head">
        <Breadcrumb items={[{ label: 'Goals', onClick: onBack }, { label: goalName(detail) }]} />
        <button type="button" className="link-button shrink-0" onClick={onEdit}>
          Edit goal
        </button>
      </div>

      <section className="flex flex-col gap-[14px]">
        <h1 className="t-display">{goal.text}</h1>
        <MetaLine
          items={[
            course ? 'Course' : 'On your own',
            goal.assessment !== 'none' ? ASSESSMENT_LABEL[goal.assessment] : 'Open-ended',
            goal.targetGrade ? `Target ${goal.targetGrade}` : null,
            goal.date ? formatDate(goal.date) : null,
            goal.hoursPerWeek ? `${goal.hoursPerWeek} hours a week` : null,
          ]}
        />
      </section>

      <WorkNotice detail={detail} onRetry={() => void run('compile', async () => void (await call('goals.compile', { goalId: goal.id })))} />
      {error && <Notice error>{error}</Notice>}

      {(teaching.length > 0 || goal.coursePlan.length > 0) && (
        <Section title={course ? 'Lectures' : 'Material'} meta={weeks !== null && dateName ? `${plural(weeks, 'week')} to the ${dateName === 'Exam date' ? 'exam' : 'deadline'}` : undefined} gap={18}>
          <Timeline detail={detail} teaching={teaching} />
        </Section>
      )}

      {compiled && (
        <Section
          title={isExam(goal.assessment) ? 'What the exam asks of you' : 'What you will be able to do'}
          meta={
            detail.capabilities.length > SKILLS_SHOWN ? (
              <button type="button" className="link-button" onClick={() => setAllSkills(!allSkills)}>
                {allSkills ? 'Fewer' : `All ${detail.capabilities.length} skills`}
              </button>
            ) : undefined
          }
        >
          <ul className="list-card">
            {skills.map((c) => (
              <li key={c.id} className="row">
                <Markdown text={c.statement} inline />
                <span className={`t-small shrink-0 ${SKILL_TONE[c.status]}`}>{SKILL_LABEL[c.status]}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {detail.expected.length > 0 && (
        <Section title="Expected, not in your material yet" meta={plural(detail.expected.length, 'idea')}>
          <p className="m-0 text-[13px] text-muted">The goal will likely need these. They are taught once a source covers them, or now if you choose.</p>
          <ul className="list-card">
            {detail.expected.map((e) => (
              <li key={e.nodeId} className="flex flex-col gap-[4px]">
                <span className="row">
                  <Markdown text={e.name} inline />
                  {e.started ? (
                    <span className="t-small shrink-0 text-accent-text">Learning anyway</span>
                  ) : (
                    <button
                      type="button"
                      className="link-button shrink-0"
                      onClick={() =>
                        void run('start-' + e.nodeId, async () => {
                          await call('goals.startUnverified', { goalId: goal.id, nodeId: e.nodeId });
                          onChanged();
                        })
                      }
                    >
                      Learn it anyway
                    </button>
                  )}
                </span>
                <Markdown text={e.statement} className="t-small text-soft" />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {compiled && (
        <Section title="Find your edge" meta={probe ? 'Answers are kept until you submit' : undefined}>
          {probe ? (
            <ProbeFlow
              probe={probe}
              busy={busy === 'probe-submit'}
              onSubmit={(answers: ProbeAnswerInput[]) =>
                void run('probe-submit', async () => {
                  setOutcomes(await call('probe.submit', { probeId: probe.id, answers }));
                  setProbe(null);
                  onChanged();
                })
              }
            />
          ) : outcomes ? (
            <ProbeResults outcomes={outcomes} />
          ) : (
            <>
              <p className="m-0 text-secondary">A few questions, one at a time, place you across the material so sessions start at your edge. Guessing is fine.</p>
              <div className="button-row">
                <Button onClick={() => void run('probe', async () => setProbe(await call('probe.create', { goalId: goal.id })))} disabled={busy !== null}>
                  {busy === 'probe' ? 'Writing questions…' : 'Ask me a few questions'}
                </Button>
              </div>
            </>
          )}
        </Section>
      )}
    </Screen>
  );
}

/** Uploaded lectures with how much is yours, what the scope says is coming, and the exam. */
function Timeline({ detail, teaching }: { detail: GoalDetail; teaching: MaterialView[] }) {
  const { goal } = detail;
  const share = (m: MaterialView) => (m.ideas ? m.owned / m.ideas : 0);
  const currentIndex = teaching.findIndex((m) => share(m) < LECTURE_DONE);
  const items: { key: string; state: PointState; children: React.ReactNode }[] = teaching.map((m, i) => {
    const state: PointState = i === currentIndex ? 'current' : share(m) >= LECTURE_DONE ? 'done' : 'upcoming';
    const reading = m.status !== 'done' && m.status !== 'failed';
    return {
      key: m.sourceId,
      state,
      children: (
        <div className="flex items-center justify-between gap-[16px]">
          <div className="flex min-w-0 flex-col">
            <span className={state === 'current' ? 'font-medium' : state === 'upcoming' ? 'text-secondary' : undefined}>{m.title}</span>
            <span className="t-small text-muted">
              {reading ? `Reading, ${m.chunksDone} of ${m.chunkCount} parts` : `${plural(m.ideas, 'idea')} · ${m.owned} yours${state === 'current' ? ' · learning now' : ''}`}
            </span>
          </div>
          {!reading && m.ideas > 0 && <Meter value={share(m)} accent={state === 'current'} />}
        </div>
      ),
    };
  });
  for (const unit of goal.coursePlan) {
    items.push({
      key: `plan-${unit.title}`,
      state: 'upcoming',
      children: (
        <div className="flex flex-col">
          <span className="text-secondary">{unit.title}</span>
          {unit.expected && <span className="t-small text-muted">Expected {unit.expected}</span>}
        </div>
      ),
    });
  }
  const dateName = dateLabel(goal.assessment);
  if (goal.date && dateName) {
    const exam = dateName === 'Exam date';
    const mocks = goal.assessment === 'written_exam' ? mockStart(goal.date) : null;
    items.push({
      key: 'milestone',
      state: 'milestone',
      children: (
        <div className="flex flex-col">
          <span>{exam ? 'Exam' : 'Deadline'}</span>
          <span className="t-small text-muted">
            {formatDate(goal.date, false)}
            {mocks ? ` · mock exams from ${mocks}` : ''}
          </span>
        </div>
      ),
    });
  }
  return <VerticalPath items={items} />;
}

/** Mock exams start four weeks before a written exam (design §3, M5). */
function mockStart(date: string): string | null {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() - 28);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

function WorkNotice({ detail, onRetry }: { detail: GoalDetail; onRetry: () => void }) {
  const { work } = detail;
  if (work.state === 'idle') return null;
  if (work.state === 'failed')
    return (
      <div className="button-row">
        <Notice error>Mapping the goal failed: {work.message}</Notice>
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
