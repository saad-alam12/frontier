import { useCallback, useEffect, useState } from 'react';
import { call } from '../api';
import type { GoalDetail, LessonPlan, ProbeOutcome, ProbeView } from '../../backend/api/contract';
import { Button, Empty, Field, Page, inputClass } from '../components/Page';
import { useDrafts } from '../hooks/useDrafts';
import { AnswerSurface } from '../components/AnswerSurface';

type ProbeDraft = { answer: string; confidence: number | null };
const EMPTY_DRAFT: ProbeDraft = { answer: '', confidence: null };

export function GoalsScreen() {
  const [goals, setGoals] = useState<GoalDetail[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [priority, setPriority] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeView | null>(null);
  const [outcomes, setOutcomes] = useState<ProbeOutcome[] | null>(null);
  const [plan, setPlan] = useState<LessonPlan | null>(null);

  const refresh = useCallback(async () => setGoals(await call('goals.list')), []);
  useEffect(() => {
    void refresh();
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

  const addGoal = () =>
    run('add', async () => {
      if (!text.trim()) return;
      const detail = await call('goals.add', { text, priority });
      setText('');
      await refresh();
      setSelected(detail.goal.id);
    });

  const current = goals.find((g) => g.goal.id === selected) ?? null;
  const drafts = useDrafts<ProbeDraft>(probe ? probe.questions.map((q) => `probe:${q.problemId}`) : [], EMPTY_DRAFT);
  const draftFor = (problemId: string) => drafts.values[`probe:${problemId}`] ?? EMPTY_DRAFT;

  // An unsubmitted probe comes back whenever its goal is opened again.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    void call('probe.open', { goalId: selected }).then((open) => {
      if (!cancelled) setProbe(open);
    });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const compile = () =>
    run('compile', async () => {
      if (!current) return;
      await call('goals.compile', { goalId: current.goal.id });
      await refresh();
      setPlan(null);
    });

  const startProbe = () =>
    run('probe', async () => {
      if (!current) return;
      const view = await call('probe.create', { goalId: current.goal.id });
      setProbe(view);
      setOutcomes(null);
    });

  const submitProbe = () =>
    run('submitProbe', async () => {
      if (!probe) return;
      const result = await call('probe.submit', {
        probeId: probe.id,
        answers: probe.questions.map((q) => ({ problemId: q.problemId, ...draftFor(q.problemId) })),
      });
      setOutcomes(result);
      setProbe(null);
      await refresh();
    });

  const preview = () =>
    run('plan', async () => {
      if (!current) return;
      setPlan(await call('plan.preview', { goalId: current.goal.id }));
    });

  return (
    <Page title="Goals" subtitle="State what you want to be able to do. Frontier compiles it into capabilities and the ideas each needs.">
      <div className="grid grid-cols-[minmax(260px,1fr)_2fr] gap-6">
        <div className="space-y-4">
          <form
            className="space-y-3 rounded-lg border border-stone-200 bg-white p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void addGoal();
            }}
          >
            <Field label="New goal">
              <textarea className={inputClass} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Pass the game theory exam with a 1.3" />
            </Field>
            <Field label="Priority" hint="Higher means more important. 1 is normal.">
              <input className={inputClass} type="number" min={0.1} step={0.5} value={priority} onChange={(e) => setPriority(Number(e.target.value) || 1)} />
            </Field>
            <Button kind="primary" type="submit" disabled={busy !== null || !text.trim()}>
              Add goal
            </Button>
          </form>
          {goals.length === 0 ? (
            <Empty>No goals yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {goals.map((g) => (
                <li key={g.goal.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(g.goal.id);
                      setOutcomes(null);
                      setPlan(null);
                    }}
                    className={'w-full rounded-lg border p-3 text-left ' + (selected === g.goal.id ? 'border-stone-900 bg-white' : 'border-stone-200 bg-white hover:border-stone-400')}
                  >
                    <div className="text-sm font-medium">{g.goal.text}</div>
                    <div className="mt-1 text-xs text-stone-500">
                      priority {g.goal.priority} · {g.goal.status} · {g.capabilities.length ? `${g.capabilities.length} capabilities` : 'not compiled'}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {!current ? (
            <Empty>Select a goal.</Empty>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button kind="primary" onClick={() => void compile()} disabled={busy !== null}>
                  {busy === 'compile' ? 'Compiling…' : current.capabilities.length ? 'Compile again' : 'Compile'}
                </Button>
                <Button onClick={() => void startProbe()} disabled={busy !== null || current.capabilities.length === 0}>
                  {busy === 'probe' ? 'Writing questions…' : 'Probe what I know'}
                </Button>
                <Button onClick={() => void preview()} disabled={busy !== null || current.capabilities.length === 0}>
                  {busy === 'plan' ? 'Planning…' : 'Preview next session'}
                </Button>
                <select
                  className="ml-auto rounded-md border border-stone-300 bg-white px-2 py-1 text-sm"
                  value={current.goal.status}
                  onChange={(e) => void run('status', async () => {
                    await call('goals.update', { goalId: current.goal.id, status: e.target.value as 'active' | 'paused' | 'done' });
                    await refresh();
                  })}
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="done">Done</option>
                </select>
                <Button
                  kind="danger"
                  onClick={() => void run('remove', async () => {
                    await call('goals.remove', { goalId: current.goal.id });
                    setSelected(null);
                    await refresh();
                  })}
                >
                  Remove
                </Button>
              </div>

              {current.capabilities.length > 0 && (
                <section className="rounded-lg border border-stone-200 bg-white p-4">
                  <h2 className="mb-2 font-medium">Capabilities</h2>
                  <ol className="space-y-3">
                    {current.capabilities.map((cap, i) => (
                      <li key={cap.id}>
                        <div className="text-sm">
                          <span className="text-stone-400">{i + 1}.</span> {cap.statement}
                          {cap.masteredAt && <span className="ml-2 rounded bg-green-50 px-1.5 text-[10px] uppercase text-green-700">mastered</span>}
                        </div>
                        <ul className="mt-1 flex flex-wrap gap-1.5">
                          {cap.targets.map((t) => (
                            <li key={t.nodeId} className="rounded border border-stone-200 px-1.5 py-0.5 text-xs text-stone-700" title={t.status === 'unverified' ? 'Not grounded in a source yet' : t.kind}>
                              {t.name} <span className="text-stone-400">{t.currentDepth}→{t.depth}</span>
                              {t.status === 'unverified' && <span className="ml-1 text-amber-700">unverified</span>}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {probe && (
                <section className="rounded-lg border border-stone-200 bg-white p-4">
                  <h2 className="mb-1 font-medium">Quick probe</h2>
                  <p className="mb-3 text-xs text-stone-500">A few questions place you across the topic. Answer in your own words; guessing is fine, say how sure you are.</p>
                  <ol className="space-y-4">
                    {probe.questions.map((q, i) => {
                      const a = draftFor(q.problemId);
                      const set = (patch: Partial<ProbeDraft>) => drafts.set(`probe:${q.problemId}`, { ...a, ...patch });
                      return (
                        <li key={q.problemId} className="space-y-2">
                          <div className="text-sm">
                            <span className="text-stone-400">{i + 1}.</span> {q.question}
                          </div>
                          <AnswerSurface value={a.answer} onChange={(answer) => set({ answer })} onSubmit={() => void submitProbe()} confidence={a.confidence} onConfidence={(confidence) => set({ confidence })} rows={3} />
                        </li>
                      );
                    })}
                  </ol>
                  <div className="mt-4 flex gap-2">
                    <Button kind="primary" onClick={() => void submitProbe()} disabled={busy !== null}>
                      {busy === 'submitProbe' ? 'Judging…' : 'Submit answers'}
                    </Button>
                    <span className="self-center text-xs text-stone-500">Answers are kept until you submit.</span>
                  </div>
                </section>
              )}

              {outcomes && (
                <section className="rounded-lg border border-stone-200 bg-white p-4">
                  <h2 className="mb-2 font-medium">Probe results</h2>
                  <ul className="space-y-3">
                    {outcomes.map((o) => (
                      <li key={o.nodeId} className="text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{o.nodeName}</span>
                          <span className={'rounded px-1.5 py-0.5 text-[10px] ' + (o.score >= 0.7 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800')}>{Math.round(o.score * 10)}/10</span>
                        </div>
                        <p className="text-stone-600">{o.reasoning}</p>
                        {o.misconception && <p className="text-red-700">Misconception noted: {o.misconception}</p>}
                        {o.impliedPremises.length > 0 && <p className="text-xs text-stone-500">Also credits: {o.impliedPremises.map((p) => p.nodeName).join(', ')}</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {plan && (
                <section className="rounded-lg border border-stone-200 bg-white p-4">
                  <h2 className="mb-1 font-medium">Next session: {plan.title}</h2>
                  <p className="mb-3 text-sm text-stone-600">{plan.orientation}</p>
                  {plan.steps.length === 0 ? (
                    <p className="text-sm text-stone-500">Nothing to plan yet.</p>
                  ) : (
                    <ol className="space-y-2">
                      {plan.steps.map((s, i) => (
                        <li key={s.nodeId} className="text-sm">
                          <span className="text-stone-400">{i + 1}.</span> <span className="font-medium">{s.name}</span>{' '}
                          <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] uppercase text-stone-600">{s.mode}</span>
                          <div className="text-stone-600">{s.why}</div>
                        </li>
                      ))}
                    </ol>
                  )}
                  <p className="mt-3 text-xs text-stone-500">
                    {plan.candidateCount} ideas are learnable now or soon.
                    {plan.unreachableTargets.length > 0 && ` Not reachable yet: ${plan.unreachableTargets.map((u) => u.name).join(', ')} (add a source that covers them).`}
                  </p>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </Page>
  );
}
