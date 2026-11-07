import { useState } from 'react';
import { call } from '../../api';
import type { Assessment, GoalBudget, GoalDetail, GoalFocus, GoalForm as GoalFormData, GoalKind } from '../../../backend/api/contract';
import { describeBudget } from '../../../backend/core/budget';
import { Breadcrumb, Screen } from '../../components/Shell';
import { Button, ChoiceChips, DefGrid, Field, Notice } from '../../components/controls';
import { TimePicker } from '../../components/budget';
import { ASSESSMENT_OPTIONS, ASSESSMENT_PHRASE, FocusChips, KIND_OPTIONS, capitalize, dateLabel, formatDate, goalName, isExam, materialSummary } from './labels';
import { defaultBudget, weeksUntil } from '../../lib/budgetDefaults';
import { MaterialPicker } from './MaterialPicker';
import { GoalCardSettingsField, saveCardSettings, useGoalCardSettings } from '../../components/CardSettings';
import type { Material } from './MaterialPicker';

/**
 * Edit a goal: everything the wizard asked, on one page, with a summary and Save on the right. Saving
 * re-plans at once (the time decides the plan) and recompiles incrementally, keeping progress.
 */
export function GoalFormScreen({ existing, onDone, onCancel, onRemoved }: { existing: GoalDetail; onDone: (goalId: string) => void; onCancel: () => void; onRemoved: () => void }) {
  const g = existing.goal;
  const [text, setText] = useState(g.text);
  const [kind, setKind] = useState<GoalKind>(g.kind);
  const [assessment, setAssessment] = useState<Assessment>(g.assessment);
  const [date, setDate] = useState(g.date ?? '');
  const [grade, setGrade] = useState(g.targetGrade ?? '');
  const [focus, setFocus] = useState<GoalFocus[]>(g.focus);
  const [background, setBackground] = useState(g.background ?? '');
  const [budget, setBudget] = useState<GoalBudget>(g.budget ?? defaultBudget(g.kind, g.date));
  const [materials, setMaterials] = useState<Material[]>(existing.materials.map((m) => ({ sourceId: m.sourceId, title: m.title, role: m.role })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [cards, setCards, cardsMade] = useGoalCardSettings(g.id);

  const dateName = dateLabel(assessment);
  const teaching = materials.filter((m) => m.role === 'teaching').length;
  const form = (): GoalFormData => ({
    text: text.trim(),
    kind,
    assessment,
    targetGrade: isExam(assessment) && grade.trim() ? grade.trim() : null,
    date: dateName && date ? date : null,
    budget,
    focus,
    background: background.trim() || null,
    materials: materials.map((m) => ({ sourceId: m.sourceId, role: m.role })),
  });

  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await call('goals.update', { goalId: g.id, form: form() });
      await saveCardSettings(g.id, cards);
      onDone(g.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const aside = (
    <>
      <h2 className="t-title">Your goal</h2>
      <DefGrid
        rows={[
          { label: 'Kind', value: kind === 'course' ? 'Course' : 'On your own' },
          { label: 'Target', value: assessment === 'none' ? 'Not assessed' : isExam(assessment) && grade.trim() ? `${grade.trim()} in ${ASSESSMENT_PHRASE[assessment]}` : capitalize(ASSESSMENT_PHRASE[assessment]) },
          ...(dateName ? [{ label: 'Date', value: date ? formatDate(date) : '—' }] : []),
          { label: 'Time', value: `${describeBudget(budget, teaching).total}, ${describeBudget(budget, teaching).detail}` },
          { label: 'Material', value: materialSummary(materials, kind === 'course') },
          { label: 'Flashcards', value: cards.enabled ? `At most ${cards.max}` : 'Off' },
        ]}
      />
      <p className="t-small m-0 text-muted">Saving re-plans the goal for its time. What you learned stays yours.</p>
      <div className="flex-grow" />
      <div className="button-row">
        <Button kind="primary" onClick={() => void save()} disabled={!text.trim() || busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
        <Button kind="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </>
  );

  return (
    <Screen aside={aside} asideLabel="Goal summary">
      <Breadcrumb items={[{ label: 'Goals', onClick: onCancel }, { label: goalName(existing), onClick: onCancel }, { label: 'Edit' }]} />
      <section className="flex flex-col gap-[36px]">
        <h1 className="t-display">Your goal</h1>
        <textarea className="goal-sentence learner-text" aria-label="Your goal in one sentence" rows={1} value={text} onChange={(e) => setText(e.target.value.replace(/\n/g, ' '))} />
        {error && <Notice error>{error}</Notice>}
        <Question label="Is this a course, or something you're learning on your own?">
          <ChoiceChips label="Kind of goal" options={KIND_OPTIONS} value={kind} onChange={setKind} />
        </Question>
        <Question label="How is it assessed?">
          <ChoiceChips label="Assessment" options={ASSESSMENT_OPTIONS} value={assessment} onChange={setAssessment} />
        </Question>
        {(dateName || isExam(assessment)) && (
          <div className="flex flex-wrap gap-[16px]">
            {dateName && (
              <div className="min-w-[200px] flex-[1_1_200px]">
                <Field label={dateName} htmlFor="goal-date">
                  <input id="goal-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
              </div>
            )}
            {isExam(assessment) && (
              <div className="min-w-[140px] flex-[1_1_140px]">
                <Field label="Target grade" htmlFor="goal-grade">
                  <input id="goal-grade" className="input" value={grade} placeholder="1.0" onChange={(e) => setGrade(e.target.value)} />
                </Field>
              </div>
            )}
          </div>
        )}
        <Question label="What do you want from it?">
          <FocusChips value={focus} onChange={setFocus} />
        </Question>
        <Field label="What do you already know about it?" htmlFor="goal-background" hint="Optional. It shapes the next map; your answers in sessions count too.">
          <input id="goal-background" className="input" value={background} onChange={(e) => setBackground(e.target.value)} />
        </Field>
        <Question label="How much time do you give it?">
          <TimePicker value={budget} onChange={setBudget} resources={teaching} allowPerResource={kind === 'course' || teaching > 0} defaultWeeks={weeksUntil(date || null)} />
        </Question>
        <Question label="Material">
          <MaterialPicker materials={materials} onChange={setMaterials} />
        </Question>
        <GoalCardSettingsField value={cards} onChange={setCards} made={cardsMade} />
        <div className="button-row border-t border-line pt-[18px]">
          {confirmRemove ? (
            <>
              <span className="t-small text-secondary">Remove this goal? Its plan goes; what you learned stays.</span>
              <Button
                kind="quiet"
                onClick={() =>
                  void call('goals.remove', { goalId: g.id }).then(onRemoved)
                }
              >
                Remove goal
              </Button>
              <Button kind="quiet" onClick={() => setConfirmRemove(false)}>
                Keep it
              </Button>
            </>
          ) : (
            <Button kind="quiet" onClick={() => setConfirmRemove(true)}>
              Remove goal
            </Button>
          )}
        </div>
      </section>
    </Screen>
  );
}

export function Question({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-col gap-[2px]">
        <div className="text-[15px] text-text">{label}</div>
        {hint && <div className="t-small text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
