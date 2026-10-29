import { useEffect, useState } from 'react';
import { call, isCancelled } from '../../api';
import type { GoalBudget, GoalDetail, GoalProgress, MaterialRole, MaterialView, PlanPreview, ProbeAnswerInput, ProbeOutcome, ProbeView } from '../../../backend/api/contract';
import { formatHours } from '../../../backend/core/budget';
import { BudgetBar, IdeaField, TimePicker, paceSentence, planSummary, trimSentence } from '../../components/budget';
import { useSurface } from '../../lib/activity';
import { depthName } from '../../lib/stages';
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

/** A goal's page: where it stands against its time and plan, one next action, then the detail. */
export function GoalPage({ detail, onBack, onEdit, onStartSession, onChanged }: { detail: GoalDetail; onBack: () => void; onEdit: () => void; onStartSession: () => Promise<void>; onChanged: () => void }) {
  const { goal } = detail;
  const [probe, setProbe] = useState<ProbeView | null>(null);
  const [outcomes, setOutcomes] = useState<ProbeOutcome[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allSkills, setAllSkills] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [editingTime, setEditingTime] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void call('probe.open', { goalId: goal.id }).then((p) => !cancelled && setProbe(p));
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
      if (!isCancelled(e)) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const course = goal.kind === 'course';
  const teaching = detail.materials.filter((m) => m.role === 'teaching');
  const weeks = weeksUntil(goal.date);
  const dateName = dateLabel(goal.assessment);
  const compiled = detail.capabilities.length > 0;
  const planned = detail.capabilities.filter((c) => c.planned);
  const leftOut = detail.capabilities.filter((c) => !c.planned);
  const skills = allSkills ? planned : planned.slice(0, SKILLS_SHOWN);
  const progress = detail.progress;

  const aside = (
    <>
      {detail.schedule && (
        <div className="flex flex-col gap-[14px]">
          <h2 className="t-title">Today</h2>
          <p className="t-lead m-0">
            <span className="text-text">{MODE_LABEL[detail.schedule.mode]}, about {detail.schedule.dailyMinutes} minutes.</span> {detail.schedule.modeReason}
          </p>
          {detail.nextIdeas.length > 0 && (
            <div className="this-week">
              <span className="text-text">New next</span>
              <Markdown text={detail.nextIdeas.join(', then ')} inline />
            </div>
          )}
        </div>
      )}
      {progress && progress.resources.some((r) => r.minutes > 0 || r.targetMinutes) && (
        <>
          <div className="divider" />
          <div className="flex flex-col gap-[14px]">
            <div className="panel-label">Time per {course ? 'lecture' : 'source'}</div>
            <ul className="resource-times">
              {progress.resources.map((r) => (
                <li key={r.sourceId}>
                  <span className="min-w-0 truncate">{r.title}</span>
                  <span className="t-small shrink-0 text-secondary">
                    {formatHours(r.minutes)}
                    {r.targetMinutes ? ` of ${formatHours(r.targetMinutes)}` : ''}
                  </span>
                  {r.targetMinutes ? <Meter value={r.minutes / r.targetMinutes} accent={r.minutes > r.targetMinutes} /> : null}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
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
          <p className="m-0 text-secondary">None. The map comes from your goal and what the questions show.</p>
        )}
      </div>
    </>
  );

  return (
    <Screen aside={aside} asideLabel="Today and material">
      <div className="section-head">
        <Breadcrumb items={[{ label: 'Goals', onClick: onBack }, { label: goalName(detail) }]} />
        <button type="button" className="link-button shrink-0" onClick={onEdit}>
          Edit goal
        </button>
      </div>

      <section className="flex flex-col gap-[12px]">
        <h1 className="t-display">{goalName(detail)}</h1>
        {goal.title && goal.title !== goal.text && <p className="t-lead m-0">{goal.text}</p>}
        <MetaLine
          items={[
            course ? 'Course' : 'On your own',
            goal.assessment !== 'none' ? ASSESSMENT_LABEL[goal.assessment] : 'Open-ended',
            goal.targetGrade ? `Target ${goal.targetGrade}` : null,
            goal.date ? formatDate(goal.date) : null,
          ]}
        />
      </section>

      <WorkNotice detail={detail} onRetry={() => void run('compile', async () => void (await call('goals.compile', { goalId: goal.id })))} />
      {error && <Notice error>{error}</Notice>}

      {progress && (
        <div className="goal-hero">
          {editingTime ? (
            <TimeEditor detail={detail} onClose={() => setEditingTime(false)} onSaved={() => {
              setEditingTime(false);
              onChanged();
            }} />
          ) : (
            <>
              <ProgressFigures progress={progress} />
              <BudgetBar progress={{ ...progress, plannedMinutes: progress.plan.plannedMinutes }} />
              <PaceNotes progress={progress} />
              <div className="button-row">
                <Button kind="primary" onClick={() => void run('session', onStartSession)} disabled={!compiled || busy !== null}>
                  {busy === 'session' ? 'Planning…' : "Start today's session"}
                </Button>
                <Button onClick={() => setEditingTime(true)}>{goal.budget ? 'Change the time' : 'Set the time'}</Button>
              </div>
            </>
          )}
        </div>
      )}

      {compiled && (
        <Section title="Check where you stand" meta={probe ? 'Answers are kept until you submit' : undefined}>
          {probe ? (
            <ProbeSurface goalId={goal.id}>
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
                onStop={() => void call('probe.cancel', { probeId: probe.id })}
              />
            </ProbeSurface>
          ) : outcomes ? (
            <ProbeResults outcomes={outcomes} />
          ) : (
            <>
              <p className="m-0 text-secondary">A few quick questions. What you already know drops out of the plan, so your time goes to what is new. Guessing is fine.</p>
              <div className="button-row">
                <Button onClick={() => void run('probe', async () => setProbe(await call('probe.create', { goalId: goal.id })))} disabled={busy !== null}>
                  {busy === 'probe' ? 'Writing questions…' : 'Ask me a few questions'}
                </Button>
              </div>
            </>
          )}
        </Section>
      )}

      {(teaching.length > 0 || goal.coursePlan.length > 0) && (
        <Section title={course ? 'Lectures' : 'Material'} meta={weeks !== null && dateName ? `${plural(weeks, 'week')} to the ${dateName === 'Exam date' ? 'exam' : 'deadline'}` : undefined} gap={18}>
          <Timeline detail={detail} teaching={teaching} />
        </Section>
      )}

      {compiled && (
        <Section
          title={isExam(goal.assessment) ? 'What the exam asks of you' : 'What you will be able to do'}
          meta={
            planned.length > SKILLS_SHOWN ? (
              <button type="button" className="link-button" onClick={() => setAllSkills(!allSkills)}>
                {allSkills ? 'Fewer' : `All ${planned.length} skills`}
              </button>
            ) : undefined
          }
        >
          <ul className="list-card skill-list">
            {skills.map((c) => (
              <SkillRow key={c.id} skill={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} />
            ))}
          </ul>
          {leftOut.length > 0 && (
            <details className="disclosure">
              <summary>
                {plural(leftOut.length, 'skill')} left out for this time
              </summary>
              <ul className="list-card skill-list is-muted">
                {leftOut.map((c) => (
                  <SkillRow key={c.id} skill={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} />
                ))}
              </ul>
            </details>
          )}
        </Section>
      )}

      {detail.expected.length > 0 && (
        <details className="disclosure">
          <summary>
            {plural(detail.expected.length, 'idea')} expected, not in your material yet
          </summary>
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
        </details>
      )}
    </Screen>
  );
}

const MODE_LABEL = { build: 'Build', deepen: 'Deepen', consolidate: 'Consolidate' } as const;

/** Ideas ready against the plan, time against the budget, and this week against the rhythm. */
function ProgressFigures({ progress }: { progress: GoalProgress }) {
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

function PaceNotes({ progress }: { progress: GoalProgress }) {
  const pace = paceSentence(progress);
  const trim = trimSentence(progress.plan);
  if (!progress.budget) return <p className="t-small m-0 text-secondary">Give the goal a time and the plan is sized to it: the most useful ideas first.</p>;
  if (!pace && !trim) return null;
  return (
    <div className="pace-notes">
      {pace && <p className={`m-0 pace-${pace.tone}`}>{pace.text}</p>}
      {trim && <p className="t-small m-0 text-secondary">{trim}</p>}
    </div>
  );
}

/** Change the time with the plan re-computed live, then save. */
function TimeEditor({ detail, onClose, onSaved }: { detail: GoalDetail; onClose: () => void; onSaved: () => void }) {
  const { goal } = detail;
  const [budget, setBudget] = useState<GoalBudget | null>(goal.budget);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [saving, setSaving] = useState(false);
  const teaching = detail.materials.filter((m) => m.role === 'teaching').length;
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => void call('goals.preview', { goalId: goal.id, budget }).then((p) => live && setPreview(p)), 120);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [goal.id, budget]);
  const summary = preview ? planSummary(preview.plan) : null;
  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-[4px]">
        <h2 className="t-heading">How much time do you give it?</h2>
        <p className="t-small m-0 text-secondary">The plan keeps what you know and re-spends the time that is left, most useful ideas first.</p>
      </div>
      <TimePicker value={budget} onChange={setBudget} resources={teaching} allowPerResource={goal.kind === 'course' || teaching > 0} defaultWeeks={weeksUntil(goal.date)} />
      {summary && preview && (
        <div className="flex flex-col gap-[12px]">
          <div>
            <span className="font-medium">{summary.headline}</span> <span className="text-secondary">· {summary.detail}</span>
          </div>
          <IdeaField ideas={preview.ideas} />
        </div>
      )}
      <div className="button-row">
        <Button
          kind="primary"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            void call('goals.update', { goalId: goal.id, form: { budget } }).then(onSaved, () => setSaving(false));
          }}
        >
          {saving ? 'Saving…' : 'Save the new time'}
        </Button>
        <Button kind="quiet" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** A skill, with its ideas and how deep each is planned when opened. */
function SkillRow({ skill, open, onToggle }: { skill: GoalDetail['capabilities'][number]; open: boolean; onToggle: () => void }) {
  return (
    <li className="flex flex-col gap-[12px]">
      <button type="button" className="row skill-head" aria-expanded={open} onClick={onToggle}>
        <span className="flex min-w-0 items-start gap-[10px]">
          <span className={open ? 'chevron is-open' : 'chevron'} aria-hidden="true" />
          <Markdown text={skill.statement} inline />
        </span>
        <span className={`t-small shrink-0 ${skill.planned ? SKILL_TONE[skill.status] : 'text-muted'}`}>{skill.planned ? SKILL_LABEL[skill.status] : 'Left out'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-[10px]">
          <ul className="skill-ideas">
            {skill.targets.map((t) => (
              <li key={t.nodeId}>
                <Markdown text={t.name} inline />
                <DepthPips current={t.currentDepth} planned={t.depth} ideal={t.idealDepth} />
              </li>
            ))}
          </ul>
          <div className="pip-legend">
            <span>
              <i className="pip is-known" /> you know
            </span>
            <span>
              <i className="pip is-planned" /> planned
            </span>
            <span>
              <i className="pip is-ideal" /> the goal asks, beyond your time
            </span>
          </div>
        </div>
      )}
    </li>
  );
}

/** Five pips: filled up to what you know, ringed up to what the plan holds, faint up to what the goal asks. */
function DepthPips({ current, planned, ideal }: { current: number; planned: number; ideal: number }) {
  const label = `${depthName(current)} now; planned: ${planned ? depthName(planned) : 'left out'}${planned < ideal ? `; the goal asks ${depthName(ideal)}` : ''}`;
  return (
    <span className="depth-pips" role="img" aria-label={label} title={label}>
      {[1, 2, 3, 4, 5].map((d) => (
        <span key={d} className={d <= current ? 'pip is-known' : d <= planned ? 'pip is-planned' : d <= ideal ? 'pip is-ideal' : 'pip'} />
      ))}
    </span>
  );
}

/** Time spent answering the probe counts toward the goal. */
function ProbeSurface({ goalId, children }: { goalId: string; children: React.ReactNode }) {
  useSurface('probe', { goalId });
  return <>{children}</>;
}

/** Uploaded lectures with how much is yours, what the scope says is coming, and the exam. */
function Timeline({ detail, teaching }: { detail: GoalDetail; teaching: MaterialView[] }) {
  const { goal } = detail;
  const share = (m: MaterialView) => (m.ideas ? m.owned / m.ideas : 0);
  const currentIndex = teaching.findIndex((m) => share(m) < LECTURE_DONE);
  const times = new Map((detail.progress?.resources ?? []).map((r) => [r.sourceId, r]));
  const timeText = (sourceId: string) => {
    const t = times.get(sourceId);
    if (!t || (!t.minutes && !t.targetMinutes)) return '';
    return ` · ${formatHours(t.minutes)}${t.targetMinutes ? ` of ${formatHours(t.targetMinutes)}` : ''}`;
  };
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
              {reading ? `Reading, ${m.chunksDone} of ${m.chunkCount} parts` : `${plural(m.ideas, 'idea')} · ${m.owned} yours${timeText(m.sourceId)}${state === 'current' ? ' · learning now' : ''}`}
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
