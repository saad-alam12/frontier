import { useEffect, useState } from 'react';
import { call } from '../../api';
import type { Assessment, GoalDetail, GoalForm as GoalFormData, GoalKind, MaterialRole, SourceSummary } from '../../../backend/api/contract';
import { Breadcrumb, Screen } from '../../components/Shell';
import { Button, ChoiceChips, DefGrid, Field, Notice } from '../../components/controls';
import { submitOnModEnter } from '../../components/AnswerSurface';
import { ASSESSMENT_OPTIONS, ASSESSMENT_PHRASE, capitalize, KIND_OPTIONS, ROLE_OPTIONS, dateLabel, formatDate, isExam, materialSummary, plural, weeksUntil } from './labels';

type Material = { sourceId: string; title: string; role: MaterialRole; reason?: string };

/**
 * New goal and Edit goal (docs/mockups/GoalCreate.dc.html): one sentence, then only the questions it
 * needs, with a live summary on the right. Files dropped here are added to the library unread and their
 * role is guessed from their content; reading starts when the goal is saved.
 */
export function GoalFormScreen({ existing, onDone, onCancel, onRemoved }: { existing: GoalDetail | null; onDone: (goalId: string) => void; onCancel: () => void; onRemoved: () => void }) {
  const g = existing?.goal;
  const [text, setText] = useState(g?.text ?? '');
  const [kind, setKind] = useState<GoalKind | null>(g?.kind ?? null);
  const [assessment, setAssessment] = useState<Assessment | null>(g?.assessment ?? null);
  const [date, setDate] = useState(g?.date ?? '');
  const [grade, setGrade] = useState(g?.targetGrade ?? '');
  const [hours, setHours] = useState(g?.hoursPerWeek ? String(g.hoursPerWeek) : '');
  const [materials, setMaterials] = useState<Material[]>(existing?.materials.map((m) => ({ sourceId: m.sourceId, title: m.title, role: m.role })) ?? []);
  const [library, setLibrary] = useState<SourceSummary[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    void call('library.list').then((list) => setLibrary(list.filter((s) => s.kind !== 'session')));
  }, []);

  const editing = existing !== null;
  const showKind = editing || text.trim().length > 0;
  const showAssessment = editing || kind !== null;
  const showDetails = editing || assessment !== null;
  const course = kind === 'course';
  const dateName = dateLabel(assessment);

  const addCandidates = async (pick: () => Promise<{ sourceId: string; title: string; role: MaterialRole; reason: string }[]>) => {
    setAdding(true);
    setError(null);
    try {
      const found = await pick();
      setMaterials((prev) => [...prev.filter((m) => !found.some((f) => f.sourceId === m.sourceId)), ...found]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const form = (): GoalFormData => ({
    text: text.trim(),
    kind: kind ?? 'personal',
    assessment: assessment ?? 'none',
    targetGrade: isExam(assessment) && grade.trim() ? grade.trim() : null,
    date: dateName && date ? date : null,
    hoursPerWeek: hours.trim() && Number(hours) > 0 ? Number(hours) : null,
    materials: materials.map((m) => ({ sourceId: m.sourceId, role: m.role })),
  });

  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const detail = existing ? await call('goals.update', { goalId: existing.goal.id, form: form() }) : await call('goals.create', { form: form() });
      onDone(detail.goal.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    await call('goals.remove', { goalId: existing.goal.id });
    onRemoved();
  };

  const weeks = weeksUntil(date || null);
  const unused = library.filter((s) => !materials.some((m) => m.sourceId === s.id));
  const target = !assessment ? '' : assessment === 'none' ? 'Not assessed' : isExam(assessment) && grade.trim() ? `${grade.trim()} in ${ASSESSMENT_PHRASE[assessment]}` : capitalize(ASSESSMENT_PHRASE[assessment]);
  const steps = [
    materials.some((m) => m.role === 'teaching' || m.role === 'reference') ? 'Read your material and map its ideas' : 'Build a roadmap from your goal',
    materials.some((m) => m.role === 'assessment') ? "Learn the exam's style from the past exam" : null,
    'Ask you a few questions to find your edge',
    date && dateName ? `Plan the weeks until the ${dateName === 'Exam date' ? 'exam' : 'deadline'}` : 'Plan your first session',
  ].filter((s): s is string => s !== null);

  const aside = (
    <>
      <h2 className="t-title">Your goal</h2>
      <DefGrid
        rows={[
          { label: 'Kind', value: kind ? (course ? 'Course' : 'On your own') : '—' },
          { label: 'Target', value: target || '—' },
          ...(dateName ? [{ label: 'Date', value: date ? `${formatDate(date)}${weeks !== null ? ` · ${plural(weeks, 'week')}` : ''}` : '—' }] : []),
          { label: 'Pace', value: hours.trim() ? `${hours.trim()} hours a week` : '—' },
          { label: 'Material', value: materialSummary(materials, course) },
        ]}
      />
      <div className="divider" />
      <div className="flex flex-col gap-[16px]">
        <div className="panel-label">What happens next</div>
        <ol className="m-0 flex list-none flex-col gap-[14px] p-0">
          {steps.map((s, i) => (
            <li key={s} className="flex gap-[14px]">
              <span className="step-number">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex-grow" />
      <div className="button-row">
        <Button kind="primary" onClick={() => void save()} disabled={!text.trim() || busy}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Create goal'}
        </Button>
        <Button kind="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </>
  );

  return (
    <Screen aside={aside} asideLabel="Goal summary">
      <Breadcrumb items={[{ label: 'Goals', onClick: onCancel }, ...(existing ? [{ label: existing.goal.title ?? existing.goal.text, onClick: onCancel }, { label: 'Edit' }] : [{ label: 'New goal' }])]} />

      <section className="flex flex-col gap-[36px]">
        <h1 className="t-display">{editing ? 'Your goal' : 'What do you want to achieve?'}</h1>
        <textarea
          className="goal-sentence learner-text"
          aria-label="Your goal in one sentence"
          rows={1}
          value={text}
          placeholder="Pass Deep Learning in Physics with a 1.0"
          onChange={(e) => setText(e.target.value.replace(/\n/g, ' '))}
          onKeyDown={(e) => submitOnModEnter(e, () => void save())}
        />
        {error && <Notice error>{error}</Notice>}

        <div className="flex flex-col gap-[28px]">
          {showKind && (
            <Question label="Is this a course, or something you're learning on your own?">
              <ChoiceChips label="Kind of goal" options={KIND_OPTIONS} value={kind} onChange={setKind} />
            </Question>
          )}
          {showAssessment && (
            <Question label="How is it assessed?">
              <ChoiceChips label="Assessment" options={ASSESSMENT_OPTIONS} value={assessment} onChange={setAssessment} />
            </Question>
          )}
          {showDetails && (
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
              <div className="min-w-[140px] flex-[1_1_140px]">
                <Field label="Hours per week" htmlFor="goal-hours">
                  <input id="goal-hours" className="input" inputMode="decimal" value={hours} placeholder="4" onChange={(e) => setHours(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'))} />
                </Field>
              </div>
            </div>
          )}
          {showDetails && (
            <Question label={course ? 'What material do you have? Drop files here; more can come later.' : 'Do you have material for this? Drop files here, or start without any.'}>
              <div
                className={dragging ? 'drop-zone is-dragging' : 'drop-zone'}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const paths = [...e.dataTransfer.files].map((f) => window.frontier.pathForFile(f)).filter(Boolean);
                  if (paths.length) void addCandidates(() => call('materials.addPaths', { paths }));
                }}
              >
                {materials.length > 0 && (
                  <ul className="list-card">
                    {materials.map((m) => (
                      <li key={m.sourceId} className="row items-center" title={m.reason}>
                        <span className="min-w-0 truncate">{m.title}</span>
                        <span className="flex shrink-0 items-center gap-[12px]">
                          <select
                            className={m.role === 'assessment' ? 'role-tag is-accent' : 'role-tag'}
                            aria-label={`Role of ${m.title}`}
                            value={m.role}
                            onChange={(e) => setMaterials((prev) => prev.map((x) => (x.sourceId === m.sourceId ? { ...x, role: e.target.value as MaterialRole } : x)))}
                          >
                            {ROLE_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <button type="button" className="remove-x" aria-label={`Remove ${m.title}`} onClick={() => setMaterials((prev) => prev.filter((x) => x.sourceId !== m.sourceId))}>
                            ×
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="button-row">
                  <Button onClick={() => void addCandidates(() => call('materials.pick'))} disabled={adding}>
                    {adding ? 'Looking at the files…' : 'Add files'}
                  </Button>
                  {unused.length > 0 && (
                    <select
                      className="input w-auto max-w-[280px]"
                      aria-label="Add from your library"
                      value=""
                      onChange={(e) => {
                        const source = unused.find((s) => s.id === e.target.value);
                        if (source) setMaterials((prev) => [...prev, { sourceId: source.id, title: source.title, role: 'teaching' }]);
                      }}
                    >
                      <option value="">From your library…</option>
                      {unused.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </Question>
          )}
        </div>

        {editing && (
          <div className="button-row border-t border-line pt-[18px]">
            {confirmRemove ? (
              <>
                <span className="t-small text-secondary">Remove this goal? Its skills go; what you learned stays.</span>
                <Button kind="quiet" onClick={() => void remove()}>
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
        )}
      </section>
    </Screen>
  );
}

function Question({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[12px]">
      <div className="text-[15px] text-secondary">{label}</div>
      {children}
    </div>
  );
}
