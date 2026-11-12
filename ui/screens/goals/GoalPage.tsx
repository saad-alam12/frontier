import { dueIn } from '../../lib/dueIn';
import { plainError } from '../../lib/errors';
import { useEffect, useState } from 'react';
import { MessagesSquare, RotateCcw } from 'lucide-react';
import { call, isCancelled } from '../../api';
import type { DialogueView, GoalDetail, PracticeLevel } from '../../../backend/api/contract';
import { formatHours } from '../../../backend/core/budget';
import { BudgetBar } from '../../components/budget';
import { Breadcrumb, Screen } from '../../components/Shell';
import { Button, MetaLine, Notice, Section } from '../../components/controls';
import { Markdown } from '../../components/Markdown';
import { GoalCardsLine } from '../../components/CardsLine';
import { ASSESSMENT_LABEL, LEVEL_LABEL, dateLabel, formatDate, goalName, isExam, plural } from './labels';
import { weeksUntil } from '../../lib/budgetDefaults';
import { ContextNote } from './ContextField';
import { AddComposer, AdditionPanel } from './AddToGoal';
import { Timeline } from './Timeline';
import { GoalAside } from './GoalAside';
import { GoalCheck } from './GoalCheck';
import { ProgressFigures, PaceNotes, roomSentence, TimeEditor } from './GoalTime';
import { SkillRow } from './SkillRow';
import { RemapPanel, WorkNotice } from './GoalNotices';

const SKILLS_SHOWN = 6;

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
  onTalk,
  onOpenNotes,
}: {
  detail: GoalDetail;
  onBack: () => void;
  onEdit: () => void;
  onStartSession: () => Promise<void>;
  /** Go deeper on simplified ideas (all, or these): their time joins the goal and a session on them opens. */
  onGoDeeper: (nodeIds?: string[]) => Promise<void>;
  /** Choose a session on these ideas of the goal ("Learn these now" on a skill), or a test on them ("I know these: test me"). */
  onLearn: (nodeIds: string[], testMe?: boolean) => void;
  onChanged: () => void;
  /** Start the new-goal flow with this sentence (an addition that reads like a goal of its own). */
  onNewGoal: (text: string) => void;
  onReviewCards: () => void;
  /** Open a practice set that was just written. */
  onOpenPractice: (setId: string) => void;
  /** Open an oral exam or a teach-back that just started. */
  onTalk: (dialogueId: string) => void;
  /** Open the goal's notes and cheat sheet. */
  onOpenNotes: () => void;
}) {
  const { goal } = detail;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allSkills, setAllSkills] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [editingTime, setEditingTime] = useState(false);
  const [adding, setAdding] = useState(false);
  /** An oral exam or teach-back left half-way. */
  const [openTalk, setOpenTalk] = useState<DialogueView | null>(null);
  useEffect(() => {
    let live = true;
    void call('dialogue.open', { goalId: goal.id }).then((d) => live && setOpenTalk(d));
    return () => {
      live = false;
    };
  }, [goal.id]);
  /** The goal an open session belongs to (null for a free session); undefined when none is open. */
  const [openSession, setOpenSession] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    void call('session.current').then((s) => setOpenSession(s && s.phase !== 'done' ? s.goalId : undefined));
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

  /** An oral exam or a teach-back on the goal's learned ideas; it opens with the first question. */
  const talk = (kind: 'oral' | 'teach') =>
    run(kind, async () => {
      const dialogue = await call('dialogue.start', { goalId: goal.id, kind });
      onTalk(dialogue.id);
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

  const aside = <GoalAside detail={detail} onEdit={onEdit} />;

  return (
    <Screen aside={aside} asideLabel="Today and material">
      <div className="section-head">
        <Breadcrumb items={[{ label: 'Goals', onClick: onBack }, { label: goalName(detail) }]} />
        <span className="flex shrink-0 items-baseline gap-[18px]">
          <button type="button" className="link-button" title="Your own words, notes, worked examples and flashcards; a cheat sheet; print or PDF" onClick={onOpenNotes}>
            Notes
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

      {goal.status === 'active' && compiled && (
        <div className="cards-line">
          <MessagesSquare size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>
            <strong>Talk it through</strong> with an examiner who asks why, or a beginner you teach
          </span>
          <span className="ml-auto flex shrink-0 gap-[8px]">
            {openTalk ? (
              <Button disabled={busy !== null} onClick={() => onTalk(openTalk.id)}>
                {openTalk.kind === 'oral' ? 'Continue the oral exam' : 'Continue teaching'}
              </Button>
            ) : (
              <>
                <Button disabled={busy !== null} onClick={() => void talk('oral')}>
                  {busy === 'oral' ? 'Starting…' : 'Oral exam'}
                </Button>
                <Button disabled={busy !== null} onClick={() => void talk('teach')}>
                  {busy === 'teach' ? 'Starting…' : 'Teach it back'}
                </Button>
              </>
            )}
          </span>
        </div>
      )}

      {compiled && <GoalCheck goalId={goal.id} busy={busy} run={run} onChanged={onChanged} />}

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
