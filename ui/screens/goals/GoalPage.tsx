import { dueIn } from '../../lib/dueIn';
import { plainError } from '../../lib/errors';
import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { call, isCancelled } from '../../api';
import type { GoalBudget, GoalDetail, GoalLevel, GoalProgress, MaterialRole, MaterialView, PlanPreview, PracticeLevel, ProbeAnswerInput, ProbeOutcome, ProbeView, RemapView } from '../../../backend/api/contract';
import { formatHours } from '../../../backend/core/budget';
import { MAX_FREE_IDEAS } from '../../../backend/core/freeSession';
import { OWNED_DEPTH } from '../../../backend/core/types';
import { BudgetBar, IdeaField, estimateLine, paceSentence, planSummary, trimSentence } from '../../components/budget';
import { TimeChoice } from '../../components/TimeChoice';
import { useSurface } from '../../lib/activity';
import { depthName } from '../../lib/stages';
import { Breadcrumb, Screen } from '../../components/Shell';
import { Button, DefGrid, Meter, MetaLine, Notice, Section } from '../../components/controls';
import { Markdown } from '../../components/Markdown';
import { VerticalPath } from '../../components/paths';
import type { PointState } from '../../components/paths';
import { ProbeFlow, ProbeResults } from '../../components/ProbeFlow';
import { GoalCardsLine } from '../../components/CardsLine';
import { ASSESSMENT_LABEL, LEVEL_LABEL, ROLE_OPTIONS, SKILL_LABEL, SKILL_TONE, capitalize, dateLabel, formatDate, goalName, isExam, plural } from './labels';
import { defaultBudget, weeksUntil } from '../../lib/budgetDefaults';
import { ContextNote } from './ContextField';
import { AddComposer, AdditionPanel } from './AddToGoal';

const SKILLS_SHOWN = 6;
/** A lecture counts as done once this share of its ideas is yours. */
const LECTURE_DONE = 0.8;

const ROLE_PLURAL: Record<MaterialRole, string> = { teaching: 'Teaching content', practice: 'Practice', assessment: 'Past exams', scope: 'Scope', reference: 'Reference' };

/** A goal's page: where it stands against its time and plan, one next action, then the detail. */
export function GoalPage({
  detail,
  onBack,
  onEdit,
  onStartSession,
  onGoDeeper,
  onLearn,
  onChanged,
  onNewGoal,
  onReviewCards,
  onOpenPractice,
}: {
  detail: GoalDetail;
  onBack: () => void;
  onEdit: () => void;
  onStartSession: () => Promise<void>;
  /** Go deeper on simplified ideas (all, or these): their time joins the goal and a session on them opens. */
  onGoDeeper: (nodeIds?: string[]) => Promise<void>;
  /** Choose a session on these ideas of the goal ("Learn these now" on a skill). */
  onLearn: (nodeIds: string[]) => void;
  onChanged: () => void;
  /** Start the new-goal flow with this sentence (an addition that reads like a goal of its own). */
  onNewGoal: (text: string) => void;
  onReviewCards: () => void;
  /** Open a practice set that was just written. */
  onOpenPractice: (setId: string) => void;
}) {
  const { goal } = detail;
  const [probe, setProbe] = useState<ProbeView | null>(null);
  const [outcomes, setOutcomes] = useState<ProbeOutcome[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allSkills, setAllSkills] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [editingTime, setEditingTime] = useState(false);
  const [adding, setAdding] = useState(false);
  /** Where the notes were saved, for a short confirmation. */
  const [exported, setExported] = useState<string | null>(null);
  useEffect(() => {
    if (!exported) return;
    const t = window.setTimeout(() => setExported(null), 2400);
    return () => window.clearTimeout(t);
  }, [exported]);
  /** The goal an open session belongs to (null for a free session); undefined when none is open. */
  const [openSession, setOpenSession] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    void call('session.current').then((s) => setOpenSession(s && s.phase !== 'done' ? s.goalId : undefined));
  }, [goal.id]);

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
      if (!isCancelled(e)) setError(plainError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  };

  /** Practice the learner asked for: new problems on these ideas, at the level they chose. */
  const practise = (nodeIds: string[], level: PracticeLevel) =>
    run('practise', async () => {
      const set = await call('practice.start', { goalId: goal.id, kind: 'compound', nodeIds, level });
      if (set) onOpenPractice(set.id);
      else setError('Nothing to practise here yet. Practice is for ideas you have learned. A session teaches the rest.');
    });

  const setStatus = (status: 'active' | 'paused' | 'done') =>
    run('status', async () => {
      await call('goals.setStatus', { goalId: goal.id, status });
      onChanged();
    });

  const course = goal.kind === 'course';
  const teaching = detail.materials.filter((m) => m.role === 'teaching');
  const weeks = weeksUntil(goal.date);
  const dateName = dateLabel(goal.assessment);
  const compiled = detail.capabilities.length > 0;
  const planned = detail.capabilities.filter((c) => c.planned);
  const leftOut = detail.capabilities.filter((c) => !c.planned);
  const skills = allSkills ? planned : planned.slice(0, SKILLS_SHOWN);
  const progress = detail.progress;
  const deeper = new Map(detail.simplified.ideas.map((i) => [i.nodeId, i]));

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
        {detail.materials.length > 0 && !detail.materials.some((m) => m.role === 'teaching' || m.role === 'reference') && (
          <p className="t-small m-0 text-muted">None of this is material to learn from, so the map comes from your goal itself. Add lectures, a script or notes and the map follows them.</p>
        )}
      </div>
    </>
  );

  return (
    <Screen aside={aside} asideLabel="Today and material">
      <div className="section-head">
        <Breadcrumb items={[{ label: 'Goals', onClick: onBack }, { label: goalName(detail) }]} />
        <span className="flex shrink-0 items-baseline gap-[18px]">
          <button
            type="button"
            className="link-button"
            title="Save this goal's ideas, your own words and your flashcards as a Markdown file"
            disabled={busy !== null}
            onClick={() =>
              void run('export', async () => {
                const { path } = await call('goals.exportNotes', { goalId: goal.id });
                setExported(path);
              })
            }
          >
            {exported ? 'Notes saved' : 'Export notes'}
          </button>
          <button type="button" className="link-button" onClick={onEdit}>
            Edit goal
          </button>
        </span>
      </div>

      <section className="flex flex-col gap-[12px]">
        <h1 className="t-display">{goalName(detail)}</h1>
        {goal.title && goal.title !== goal.text && <p className="t-lead m-0">{goal.text}</p>}
        {goal.context && <ContextNote text={goal.context} />}
        <MetaLine
          items={[
            course ? 'Course' : null,
            goal.assessment !== 'none' ? ASSESSMENT_LABEL[goal.assessment] : null,
            goal.wantedLevel ? 'No time limit' : null,
            goal.targetGrade ? `Target ${goal.targetGrade}` : null,
            goal.date ? formatDate(goal.date) : null,
          ]}
        />
        {goal.scope && (
          <div className="scope-note">
            <div className="t-caption text-muted">{goal.level ? LEVEL_LABEL[goal.level] : 'What it means for your time'}</div>
            <p className="m-0">{goal.scope}</p>
          </div>
        )}
      </section>

      {goal.status === 'active' && dueIn(goal.date) === 'passed' && (
        <div className="state-note" role="status">
          <span>The date of this goal has passed ({formatDate(goal.date)}). If you are done with it, mark it as finished; if it goes on, give it a new date in Edit goal.</span>
          <Button disabled={busy !== null} onClick={() => void setStatus('done')}>
            Mark as finished
          </Button>
        </div>
      )}
      {(goal.status === 'paused' || goal.status === 'done') && (
        <div className="state-note" role="status">
          <span>
            {goal.status === 'paused'
              ? 'Paused. It is left out of Today, and its ideas take no time from your other goals. Everything you learned is kept.'
              : 'Finished. It is left out of Today. What you learned stays yours, and its flashcards stay in review.'}
          </span>
          <Button disabled={busy !== null} onClick={() => void setStatus('active')}>
            {goal.status === 'paused' ? 'Resume' : 'Reopen'}
          </Button>
        </div>
      )}
      <WorkNotice detail={detail} onRetry={() => void run('compile', async () => void (await call('goals.compile', { goalId: goal.id })))} />
      {error && <Notice error>{error}</Notice>}
      <AdditionPanel goal={goal} onChanged={onChanged} onNewGoal={onNewGoal} />
      {goal.remap?.state === 'ready' && <RemapPanel goalId={goal.id} caption={goal.wantedLevel ? 'A new map for the depth you want' : 'A new map for your time'} onChanged={onChanged} />}
      {compiled && goal.status === 'active' && goal.level === null && goal.remap === null && detail.work.state === 'idle' && (
        <div className="button-row">
          <span className="t-small text-secondary">This goal was mapped before plans fitted the time.</span>
          <Button kind="quiet" disabled={busy !== null} onClick={() => void run('remap', async () => void (await call('goals.remapRequest', { goalId: goal.id }).then(onChanged)))}>
            Draw a map for your time
          </Button>
        </div>
      )}

      {progress && (
        <div className="goal-hero">
          {editingTime ? (
            <TimeEditor detail={detail} onClose={() => setEditingTime(false)} onSaved={() => {
              setEditingTime(false);
              onChanged();
            }} />
          ) : adding ? (
            <AddComposer
              goalId={goal.id}
              onClose={() => setAdding(false)}
              onSent={() => {
                setAdding(false);
                onChanged();
              }}
            />
          ) : (
            <>
              <ProgressFigures progress={progress} />
              <BudgetBar progress={{ ...progress, plannedMinutes: progress.plan.plannedMinutes }} />
              <PaceNotes progress={progress} />
              {progress.room && goal.status === 'active' && (
                <div className="simplified-note">
                  <p className="m-0">{roomSentence(progress.room)}</p>
                  <button type="button" className="link-button self-start" disabled={busy !== null} onClick={() => void run('room', async () => void (await call('goals.useFreedTime', { goalId: goal.id }).then(onChanged)))}>
                    {busy === 'room' ? 'Re-planning…' : 'Use the time'}
                  </button>
                </div>
              )}
              {detail.simplified.ideas.length > 0 && (
                <div className="simplified-note">
                  <p className="m-0 text-soft">
                    {isExam(goal.assessment)
                      ? detail.simplified.ideas.length === 1
                        ? '1 idea is simpler than your exam asks: it was taught as its core intuition.'
                        : `${detail.simplified.ideas.length} ideas are simpler than your exam asks: they were taught as their core intuition.`
                      : `${plural(detail.simplified.ideas.length, 'idea')} ${detail.simplified.ideas.length === 1 ? 'was' : 'were'} taught as ${detail.simplified.ideas.length === 1 ? 'its' : 'their'} core intuition, to fit your time and background.`}
                  </p>
                  <button type="button" className="link-button self-start" disabled={busy !== null} onClick={() => void run('deeper', () => onGoDeeper())}>
                    {busy === 'deeper' ? 'Opening a session…' : `Go deeper on ${detail.simplified.ideas.length === 1 ? 'it' : 'all'} · adds about ${formatHours(detail.simplified.minutes)} to this goal`}
                  </button>
                </div>
              )}
              <div className="button-row">
                {/* one primary action: a proposal waiting for an answer comes first */}
                {goal.status === 'active' && (
                  <Button
                    kind={goal.addition?.state === 'ready' || goal.remap?.state === 'ready' ? 'secondary' : 'primary'}
                    onClick={() => void run('session', onStartSession)}
                    disabled={!compiled || busy !== null}
                    title={openSession !== undefined && openSession !== goal.id ? 'A session is open. Finish or end it to start one for this goal.' : undefined}
                  >
                    {busy === 'session' ? 'Planning…' : openSession !== undefined ? 'Continue session' : "Start today's session"}
                  </Button>
                )}
                <Button onClick={() => setEditingTime(true)}>{goal.budget || goal.wantedLevel ? 'Change the time' : 'Set the time'}</Button>
                {/* one proposal at a time: not while an addition or a new map waits for an answer */}
                {goal.addition === null && goal.remap?.state !== 'ready' && goal.remap?.state !== 'requested' && <Button onClick={() => setAdding(true)}>Add to this goal</Button>}
              </div>
            </>
          )}
        </div>
      )}

      <GoalCardsLine goalId={goal.id} onReview={onReviewCards} />
      {goal.status === 'active' && detail.missed.length > 0 && (
        <div className="cards-line" title={detail.missed.map((m) => m.name).join(', ')}>
          <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>
            <strong>{plural(detail.missed.length, 'idea')}</strong> from problems you missed
          </span>
          <Button disabled={busy !== null} onClick={() => void practise(detail.missed.map((m) => m.nodeId), 'normal')}>
            {busy === 'practise' ? 'Writing problems…' : 'Practise again'}
          </Button>
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
              <SkillRow key={c.id} skill={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} deeper={deeper} onGoDeeper={(id) => void run('deeper', () => onGoDeeper([id]))} onLearn={onLearn} onPractise={goal.status === 'active' ? practise : undefined} writing={busy === 'practise'} />
            ))}
          </ul>
          {leftOut.length > 0 && (
            <details className="disclosure">
              <summary>
                {plural(leftOut.length, 'skill')} left out for this time
              </summary>
              <ul className="list-card skill-list is-muted">
                {leftOut.map((c) => (
                  <SkillRow key={c.id} skill={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} deeper={deeper} onGoDeeper={(id) => void run('deeper', () => onGoDeeper([id]))} />
                ))}
              </ul>
            </details>
          )}
        </Section>
      )}

      {detail.expected.length > 0 && (
        <details className="disclosure">
          <summary>
            {plural(detail.expected.length, 'idea')} the goal needs that your material does not cover yet
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

      {goal.status !== 'draft' && goal.status !== 'done' && (
        <div className="button-row border-t border-line pt-[18px]">
          {goal.status === 'active' && (
            <Button kind="quiet" disabled={busy !== null} title="Leave it out of Today and of your other goals' plans until you resume it. Nothing is lost." onClick={() => void setStatus('paused')}>
              Pause this goal
            </Button>
          )}
          <Button kind="quiet" disabled={busy !== null} title="You are done with it. What you learned and its flashcards are kept, and you can reopen it." onClick={() => void setStatus('done')}>
            Mark as finished
          </Button>
        </div>
      )}
    </Screen>
  );
}

const MODE_LABEL = { build: 'Build', deepen: 'Deepen', consolidate: 'Consolidate' } as const;

/**
 * Ideas ready against the plan, time against the budget, and this week against the rhythm. With no
 * time limit: the time studied and the estimate of what is left.
 */
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

function PaceNotes({ progress }: { progress: GoalProgress }) {
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
function roomSentence(room: NonNullable<GoalProgress['room']>): string {
  const parts = [room.more ? `${room.more} more ${room.more === 1 ? 'idea' : 'ideas'}` : null, room.deeper ? `${room.deeper} in more depth` : null].filter(Boolean);
  return `Your time now holds ${parts.join(' and ')}: about ${formatHours(room.minutes)} of it are not planned, because you knew or learned some of the plan faster than expected.`;
}

/**
 * Change the time, or switch between a time and no time limit, with the plan re-computed live, then
 * save. A new amount of time re-plans the same map; a new depth or a switch asks for a new map.
 */
function TimeEditor({ detail, onClose, onSaved }: { detail: GoalDetail; onClose: () => void; onSaved: () => void }) {
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

/** A skill, with its ideas and how deep each is planned when opened. */
function SkillRow({
  skill,
  open,
  onToggle,
  deeper,
  onGoDeeper,
  onLearn,
  onPractise,
  writing = false,
}: {
  skill: GoalDetail['capabilities'][number];
  open: boolean;
  onToggle: () => void;
  deeper: Map<string, GoalDetail['simplified']['ideas'][number]>;
  onGoDeeper: (nodeId: string) => void;
  /** Planned skills only: choose a session on the ideas not yet at their planned depth. */
  onLearn?: (nodeIds: string[]) => void;
  /** Planned skills only: new problems on the ideas already learned, at a chosen level. */
  onPractise?: (nodeIds: string[], level: PracticeLevel) => void;
  /** Problems are being written. */
  writing?: boolean;
}) {
  const [level, setLevel] = useState<PracticeLevel>('normal');
  const toLearn = skill.targets.filter((t) => t.depth > 0 && t.currentDepth < t.depth).map((t) => t.nodeId);
  const learned = skill.targets.filter((t) => t.currentDepth >= OWNED_DEPTH).map((t) => t.nodeId);
  return (
    <li className="flex flex-col gap-[12px]">
      <button type="button" className="row skill-head" aria-expanded={open} onClick={onToggle}>
        <span className="flex min-w-0 items-start gap-[10px]">
          <span className={open ? 'chevron is-open' : 'chevron'} aria-hidden="true" />
          <span className="flex min-w-0 flex-col gap-[2px]">
            <Markdown text={skill.statement} inline />
            {skill.request && <span className="added-mark">You added this · “{skill.request}”</span>}
          </span>
        </span>
        <span className={`t-small shrink-0 ${skill.planned ? SKILL_TONE[skill.status] : 'text-muted'}`}>{skill.planned ? SKILL_LABEL[skill.status] : 'Left out'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-[10px]">
          <ul className="skill-ideas">
            {skill.targets.map((t) => {
              const simple = deeper.get(t.nodeId);
              return (
                <li key={t.nodeId}>
                  <span className="flex min-w-0 flex-col gap-[2px]">
                    <Markdown text={t.name} inline />
                    {simple && (
                      <span className="t-small text-muted">
                        Simplified: {simple.reason}.{' '}
                        <button type="button" className="link-button" onClick={() => onGoDeeper(t.nodeId)}>
                          Go deeper · adds about {simple.minutes} min
                        </button>
                      </span>
                    )}
                  </span>
                  <DepthPips current={t.currentDepth} planned={t.depth} ideal={t.idealDepth} />
                </li>
              );
            })}
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
          {((onLearn && toLearn.length > 0) || (onPractise && learned.length > 0)) && (
            <div className="skill-actions">
              {onPractise && learned.length > 0 && (
                <>
                  <button type="button" className="link-button" disabled={writing} onClick={() => onPractise(learned, level)}>
                    {writing ? 'Writing problems…' : learned.length === skill.targets.length ? 'Practise this skill now' : 'Practise what you have learned'}
                  </button>
                  <select className="select-quiet" aria-label="How hard the problems are" value={level} disabled={writing} onChange={(e) => setLevel(e.target.value as PracticeLevel)}>
                    <option value="easier">Easier</option>
                    <option value="normal">As planned</option>
                    <option value="harder">Harder</option>
                  </select>
                </>
              )}
              {onLearn && toLearn.length > 0 && (
                <button type="button" className="link-button ml-auto" onClick={() => onLearn(toLearn.slice(0, MAX_FREE_IDEAS))}>
                  Learn these now
                </button>
              )}
            </div>
          )}
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

/**
 * A new map proposed for what the learner's answers showed (or that they asked for), next to the plan
 * they have: same time, how many sessions and ideas each gives, the new map's dots. Nothing changes
 * until they choose it.
 */
function RemapPanel({ goalId, caption, onChanged }: { goalId: string; caption: string; onChanged: () => void }) {
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

function WorkNotice({ detail, onRetry }: { detail: GoalDetail; onRetry: () => void }) {
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
