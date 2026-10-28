import { useCallback, useEffect, useRef, useState } from 'react';
import { call, onEvent } from '../../api';
import type { Assessment, GoalBudget, GoalDetail, GoalFocus, GoalForm as GoalFormData, GoalKind, PlanPreview } from '../../../backend/api/contract';
import { Screen } from '../../components/Shell';
import { Button, ChoiceChips, Field, Notice } from '../../components/controls';
import { StepPath } from '../../components/paths';
import type { PointState } from '../../components/paths';
import { IdeaField, TimePicker, planSummary, trimSentence } from '../../components/budget';
import { submitOnModEnter } from '../../components/AnswerSurface';
import { ASSESSMENT_OPTIONS, FocusChips, KIND_OPTIONS, dateLabel, isExam, weeksUntil } from './labels';
import { MaterialPicker } from './MaterialPicker';
import type { Material } from './MaterialPicker';
import { Question } from './GoalForm';

type Step = 'goal' | 'material' | 'time' | 'plan';
const STEPS: { key: Step; label: string }[] = [
  { key: 'goal', label: 'Your goal' },
  { key: 'material', label: 'Material' },
  { key: 'time', label: 'Time' },
  { key: 'plan', label: 'Your plan' },
];

const EXAMPLES = ['Pass my linear algebra exam with a 1.3', 'Learn machine learning, from the maths to building models', 'Understand the paper "Attention is all you need"'];

/**
 * A new goal, one decision per step: what you want, what material you have, how much time you give
 * it, then the plan that time buys, which you approve. Steps 1–3 only collect; after step 3 the goal
 * exists as a draft and is mapped in the background; the plan step re-plans live as the time moves.
 */
export function GoalWizard({ draft, onDone, onCancel }: { draft: GoalDetail | null; onDone: (goalId: string) => void; onCancel: () => void }) {
  const d = draft?.goal;
  const [step, setStep] = useState<Step>(draft ? 'plan' : 'goal');
  const [text, setText] = useState(d?.text ?? '');
  const [kind, setKind] = useState<GoalKind | null>(d?.kind ?? null);
  const [assessment, setAssessment] = useState<Assessment | null>(d?.assessment ?? null);
  const [date, setDate] = useState(d?.date ?? '');
  const [grade, setGrade] = useState(d?.targetGrade ?? '');
  const [focus, setFocus] = useState<GoalFocus[]>(d?.focus ?? []);
  const [materials, setMaterials] = useState<Material[]>(draft?.materials.map((m) => ({ sourceId: m.sourceId, title: m.title, role: m.role })) ?? []);
  const [budget, setBudget] = useState<GoalBudget | null>(d?.budget ?? null);
  const [goalId, setGoalId] = useState<string | null>(d?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateName = dateLabel(assessment);
  const teaching = materials.filter((m) => m.role === 'teaching').length;
  const index = STEPS.findIndex((s) => s.key === step);

  const form = (): GoalFormData => ({
    text: text.trim(),
    kind: kind ?? 'personal',
    assessment: assessment ?? 'none',
    targetGrade: isExam(assessment) && grade.trim() ? grade.trim() : null,
    date: dateName && date ? date : null,
    budget: budget ?? defaultBudget(kind, dateName && date ? date : null),
    focus,
    materials: materials.map((m) => ({ sourceId: m.sourceId, role: m.role })),
  });

  /** Save what was collected: create the draft the first time, update it after. */
  const toPlan = async () => {
    setBusy(true);
    setError(null);
    try {
      const f = form();
      setBudget(f.budget ?? null);
      if (goalId) await call('goals.update', { goalId, form: f });
      else setGoalId((await call('goals.create', { form: f, draft: true })).goal.id);
      setStep('plan');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const steps = STEPS.map((s, i) => ({
    key: s.key,
    label: s.label,
    state: (i < index ? 'done' : i === index ? 'current' : 'upcoming') as PointState,
    onClick: i < index ? () => setStep(s.key) : undefined,
  }));

  return (
    <Screen>
      <div className="wizard">
        <div className="wizard-top">
          <StepPath steps={steps} label="Setting up a goal" />
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            {goalId ? 'Finish later' : 'Cancel'}
          </button>
        </div>
        {error && <Notice error>{error}</Notice>}

        {step === 'goal' && (
          <section className="wizard-step">
            <h1 className="t-display">What do you want to learn?</h1>
            <textarea
              className="goal-sentence learner-text"
              aria-label="Your goal in one sentence"
              rows={1}
              value={text}
              autoFocus
              placeholder="Say it in one sentence"
              onChange={(e) => setText(e.target.value.replace(/\n/g, ' '))}
              onKeyDown={(e) => submitOnModEnter(e, () => text.trim() && setStep('material'))}
            />
            {!text.trim() && (
              <div className="example-row">
                <span className="t-small text-muted">For example</span>
                {EXAMPLES.map((x) => (
                  <button key={x} type="button" className="mini-chip" onClick={() => setText(x)}>
                    {x}
                  </button>
                ))}
              </div>
            )}
            {text.trim() && (
              <div className="flex flex-col gap-[28px]">
                <Question label="Is it a course, or something of your own?" hint="A course has lectures that keep arriving and usually an exam.">
                  <ChoiceChips label="Kind of goal" options={KIND_OPTIONS} value={kind} onChange={setKind} />
                </Question>
                {kind && (
                  <Question label="How is it assessed?" hint="This shapes what you practise: exam problems, explaining aloud, or doing the thing.">
                    <ChoiceChips label="Assessment" options={ASSESSMENT_OPTIONS} value={assessment} onChange={setAssessment} />
                  </Question>
                )}
                {assessment && (dateName || isExam(assessment)) && (
                  <div className="flex flex-wrap gap-[16px]">
                    {dateName && (
                      <div className="min-w-[200px] flex-[1_1_200px]">
                        <Field label={dateName} htmlFor="goal-date" hint="Optional. Reviews are timed so you remember most on the day.">
                          <input id="goal-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                        </Field>
                      </div>
                    )}
                    {isExam(assessment) && (
                      <div className="min-w-[140px] flex-[1_1_140px]">
                        <Field label="Target grade" htmlFor="goal-grade" hint="Optional.">
                          <input id="goal-grade" className="input" value={grade} placeholder="1.0" onChange={(e) => setGrade(e.target.value)} />
                        </Field>
                      </div>
                    )}
                  </div>
                )}
                {assessment && (
                  <Question label="What do you want from it?" hint="Pick any. None means a balanced mix.">
                    <FocusChips value={focus} onChange={setFocus} />
                  </Question>
                )}
              </div>
            )}
            <WizardNav onNext={() => setStep('material')} nextDisabled={!text.trim() || !kind || !assessment} />
          </section>
        )}

        {step === 'material' && (
          <section className="wizard-step">
            <h1 className="t-display">Do you have material for it?</h1>
            <div className="explain-grid">
              <Explainer title="A whole course or book">The map is built around it.</Explainer>
              <Explainer title="A paper, an article, a video">The map comes from your goal; the material grounds the parts it covers.</Explainer>
              <Explainer title="Nothing yet">The map comes from your goal alone. Add material any time.</Explainer>
            </div>
            <MaterialPicker materials={materials} onChange={setMaterials} big />
            <WizardNav onBack={() => setStep('goal')} onNext={() => setStep('time')} nextLabel={materials.length ? 'Continue' : 'Continue without material'} />
          </section>
        )}

        {step === 'time' && (
          <section className="wizard-step">
            <div className="flex flex-col gap-[12px]">
              <h1 className="t-display">How much time do you give it?</h1>
              <p className="t-lead m-0">
                Your time decides the map. With less, you get the most useful ideas, mostly as an overview. With more, more ideas, deeper. You can change it whenever things change.
              </p>
            </div>
            <TimePicker
              value={budget ?? defaultBudget(kind, dateName && date ? date : null)}
              onChange={setBudget}
              resources={teaching}
              allowPerResource={kind === 'course' || teaching > 0}
              defaultWeeks={weeksUntil(dateName && date ? date : null)}
            />
            <WizardNav onBack={() => setStep('material')} onNext={() => void toPlan()} nextLabel={busy ? 'Saving…' : goalId ? 'See the plan' : 'Map my goal'} nextDisabled={busy} />
          </section>
        )}

        {step === 'plan' && goalId && <PlanStep goalId={goalId} budget={budget} onBudget={setBudget} onBack={() => setStep('time')} onDone={onDone} />}
      </div>
    </Screen>
  );
}

/** A sensible starting point: a course runs to its date at a few hours a week; anything else, ten hours. */
function defaultBudget(kind: GoalKind | null, date: string | null): GoalBudget {
  const weeks = weeksUntil(date);
  if (kind === 'course') return { mode: 'rate', hours: 4, per: 'week', length: Math.max(1, weeks ?? 12), lengthUnit: 'weeks' };
  return { mode: 'total', hours: 10 };
}

function Explainer({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="explainer">
      <div className="font-medium">{title}</div>
      <div className="t-small text-secondary">{children}</div>
    </div>
  );
}

function WizardNav({ onBack, onNext, nextLabel = 'Continue', nextDisabled }: { onBack?: () => void; onNext: () => void; nextLabel?: string; nextDisabled?: boolean }) {
  return (
    <div className="wizard-nav">
      {onBack ? (
        <Button kind="quiet" onClick={onBack}>
          Back
        </Button>
      ) : (
        <span />
      )}
      <Button kind="primary" onClick={onNext} disabled={nextDisabled}>
        {nextLabel}
      </Button>
    </div>
  );
}

/**
 * The plan for the time: while the goal is mapped, a quiet placeholder; then how many sessions and
 * ideas it comes to, the ideas as a field of dots, and the time control, which re-plans live.
 */
function PlanStep({ goalId, budget, onBudget, onBack, onDone }: { goalId: string; budget: GoalBudget | null; onBudget: (b: GoalBudget) => void; onBack: () => void; onDone: (goalId: string) => void }) {
  const [detail, setDetail] = useState<GoalDetail | null>(null);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async () => setDetail(await call('goals.get', { goalId })), [goalId]);
  useEffect(() => {
    void refresh();
    const offs = [onEvent('goals.changed', (e) => e.goalId === goalId && void refresh()), onEvent('library.progress', () => void refresh())];
    return () => offs.forEach((off) => off());
  }, [goalId, refresh]);

  const mapped = (detail?.capabilities.length ?? 0) > 0;
  useEffect(() => {
    if (!mapped) return;
    const mine = ++seq.current;
    const t = window.setTimeout(() => void call('goals.preview', { goalId, budget }).then((p) => mine === seq.current && setPreview(p)), 120);
    return () => window.clearTimeout(t);
  }, [goalId, budget, mapped, detail?.goal.compiledAt]);

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

  if (!detail) return null;
  const work = detail.work;
  if (!mapped) {
    return (
      <section className="wizard-step">
        <h1 className="t-display">{work.state === 'failed' ? 'Mapping stopped' : 'Mapping your goal'}</h1>
        {work.state === 'failed' ? (
          <div className="button-row">
            <Notice error>{work.message}</Notice>
            <Button onClick={() => void run('compile', async () => void (await call('goals.compile', { goalId })))}>Try again</Button>
          </div>
        ) : (
          <>
            <p className="t-lead m-0">{work.state === 'idle' ? 'Starting…' : work.message}. This takes a minute or two; you can leave and come back.</p>
            <div className="idea-field is-loading" aria-hidden="true">
              {Array.from({ length: 24 }, (_, i) => (
                <span key={i} className="idea-dot is-cut" style={{ animationDelay: `${i * 60}ms` }} />
              ))}
            </div>
          </>
        )}
        <WizardNav onBack={onBack} onNext={() => undefined} nextLabel="Start with this plan" nextDisabled />
      </section>
    );
  }

  const plan = preview?.plan;
  const summary = plan ? planSummary(plan) : null;
  const teaching = detail.materials.filter((m) => m.role === 'teaching').length;
  const shared = preview?.ideas.filter((i) => i.sharedWith.length > 0) ?? [];
  const coverage = detail.goal.coverage;
  return (
    <section className="wizard-step">
      <div className="flex flex-col gap-[10px]">
        <div className="t-caption text-muted">{detail.goal.title ?? detail.goal.text}</div>
        <h1 className="t-display">{summary?.headline ?? 'Your plan'}</h1>
        {summary && <p className="t-lead m-0">{summary.detail}.</p>}
      </div>
      {preview && <IdeaField ideas={preview.ideas} />}
      <ul className="plan-notes">
        {coverage && coverage !== 'complete' && detail.materials.length > 0 && <li>Your material covers {coverage === 'partial' ? 'part' : 'a piece'} of this goal. The rest of the map comes from what the goal needs, and your material grounds the parts it covers.</li>}
        {shared.length > 0 && (
          <li>
            {shared.length} {shared.length === 1 ? 'idea is' : 'ideas are'} shared with {[...new Set(shared.flatMap((s) => s.sharedWith))].join(', ')}: learned once, counted once.
          </li>
        )}
        {plan && trimSentence(plan) && <li>{trimSentence(plan)}</li>}
        {preview?.roomForMore && <li>Your time holds more than this map. Map more ideas to use it, or keep the plan short.</li>}
      </ul>
      <div className="plan-time">
        <h2 className="t-heading">Change the time and watch the plan change</h2>
        <TimePicker value={budget} onChange={onBudget} resources={teaching} allowPerResource={detail.goal.kind === 'course' || teaching > 0} defaultWeeks={weeksUntil(detail.goal.date)} />
      </div>
      {error && <Notice error>{error}</Notice>}
      <div className="wizard-nav">
        <Button kind="quiet" onClick={onBack}>
          Back
        </Button>
        <div className="button-row">
          {preview?.roomForMore && (
            <Button
              disabled={busy !== null}
              onClick={() =>
                void run('more', async () => {
                  await call('goals.update', { goalId, form: { budget } });
                  await call('goals.compile', { goalId });
                  await refresh();
                })
              }
            >
              {busy === 'more' ? 'Mapping more…' : 'Map more ideas'}
            </Button>
          )}
          <Button
            kind="primary"
            disabled={busy !== null || !plan}
            onClick={() =>
              void run('approve', async () => {
                await call('goals.update', { goalId, form: { budget } });
                await call('goals.approve', { goalId });
                onDone(goalId);
              })
            }
          >
            {busy === 'approve' ? 'Starting…' : 'Start with this plan'}
          </Button>
        </div>
      </div>
    </section>
  );
}
