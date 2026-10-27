import { useCallback, useEffect, useState } from 'react';
import { call } from '../api';
import type { GoalDetail, LessonPlan, ProbeOutcome, ProbeView } from '../../backend/api/contract';
import { Screen, type ScreenName } from '../components/Shell';
import { Button, Empty, Field, Notice, Section } from '../components/controls';
import { Markdown } from '../components/Markdown';
import { useDrafts } from '../hooks/useDrafts';
import { AnswerSurface } from '../components/AnswerSurface';

type ProbeDraft = { answer: string; confidence: number | null };
const EMPTY_DRAFT: ProbeDraft = { answer: '', confidence: null };

export function GoalsScreen({ onNavigate }: { onNavigate: (s: ScreenName) => void }) {
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
    <Screen>
      <div className="flex flex-col gap-[14px]">
        <h1 className="t-display">Goals</h1>
        <p className="t-lead m-0">State what you want to be able to do. Frontier turns it into skills and the ideas each needs.</p>
      </div>
      {error && <Notice error>{error}</Notice>}

      <form
        className="flex flex-col gap-[18px]"
        onSubmit={(e) => {
          e.preventDefault();
          void addGoal();
        }}
      >
        <Field label="New goal" htmlFor="new-goal">
          <textarea id="new-goal" className="input learner-text" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Pass the game theory exam with a 1.3" />
        </Field>
        <Field label="Priority" htmlFor="priority" hint="Higher means more important. 1 is normal.">
          <input id="priority" className="input max-w-[140px]" type="number" min={0.1} step={0.5} value={priority} onChange={(e) => setPriority(Number(e.target.value) || 1)} />
        </Field>
        <div className="button-row">
          <Button kind="primary" type="submit" disabled={busy !== null || !text.trim()}>
            Add goal
          </Button>
        </div>
      </form>

      {goals.length > 0 && (
        <Section title="Your goals">
          <ul className="list-card">
            {goals.map((g) => (
              <li key={g.goal.id}>
                <button type="button" className="row" onClick={() => setSelected(g.goal.id)} aria-current={selected === g.goal.id ? 'true' : undefined}>
                  <span className={selected === g.goal.id ? 'font-medium' : 'text-soft'}>{g.goal.text}</span>
                  <span className="t-small shrink-0 text-muted">{g.capabilities.length ? `${g.capabilities.length} skills` : 'Not compiled'}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {current && (
        <>
          <div className="button-row">
            <Button kind="primary" onClick={() => void compile()} disabled={busy !== null}>
              {busy === 'compile' ? 'Compiling…' : current.capabilities.length ? 'Compile again' : 'Compile'}
            </Button>
            <Button onClick={() => void startProbe()} disabled={busy !== null || current.capabilities.length === 0 || probe !== null}>
              {busy === 'probe' ? 'Writing questions…' : 'Probe what I know'}
            </Button>
            <Button onClick={() => void preview()} disabled={busy !== null || current.capabilities.length === 0}>
              {busy === 'plan' ? 'Planning…' : 'Preview next session'}
            </Button>
            <Button onClick={() => onNavigate('session')} disabled={current.capabilities.length === 0}>
              Go to session
            </Button>
            <Button
              kind="quiet"
              onClick={() =>
                void run('remove', async () => {
                  await call('goals.remove', { goalId: current.goal.id });
                  setSelected(null);
                  await refresh();
                })
              }
            >
              Remove goal
            </Button>
          </div>

          {probe && (
            <Section title="Quick probe" meta="Answers are kept until you submit">
              <p className="m-0 text-secondary">A few questions place you across the topic. Guessing is fine; say how sure you are.</p>
              <ol className="m-0 flex list-none flex-col gap-[28px] p-0">
                {probe.questions.map((q, i) => {
                  const a = draftFor(q.problemId);
                  const set = (patch: Partial<ProbeDraft>) => drafts.set(`probe:${q.problemId}`, { ...a, ...patch });
                  return (
                    <li key={q.problemId} className="flex flex-col gap-[18px]">
                      <div className="t-question">
                        <span className="text-muted">{i + 1}. </span>
                        <Markdown text={q.question} inline />
                      </div>
                      <AnswerSurface value={a.answer} onChange={(answer) => set({ answer })} onSubmit={() => void submitProbe()} confidence={a.confidence} onConfidence={(confidence) => set({ confidence })} rows={3} />
                    </li>
                  );
                })}
              </ol>
              <div className="button-row">
                <Button kind="primary" onClick={() => void submitProbe()} disabled={busy !== null}>
                  {busy === 'submitProbe' ? 'Judging…' : 'Submit answers'}
                </Button>
              </div>
            </Section>
          )}

          {outcomes && (
            <Section title="Probe results">
              <ul className="list-card">
                {outcomes.map((o) => (
                  <li key={o.nodeId} className="flex flex-col gap-[4px]">
                    <div className="row">
                      <span className="font-medium">{o.nodeName}</span>
                      <span className="shrink-0">{Math.round(o.score * 10)}/10</span>
                    </div>
                    <Markdown text={o.reasoning} className="text-soft" />
                    {o.misconception && <p className="t-small m-0 text-secondary">Noted to repair: {o.misconception}</p>}
                    {o.impliedPremises.length > 0 && <p className="t-small m-0 text-muted">Also credits: {o.impliedPremises.map((p) => p.nodeName).join(', ')}</p>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {current.capabilities.length > 0 && (
            <Section title="Skills">
              <ul className="list-card">
                {current.capabilities.map((cap) => (
                  <li key={cap.id} className="flex flex-col gap-[6px]">
                    <div className="row">
                      <span>{cap.statement}</span>
                      {cap.masteredAt && <span className="t-small shrink-0 text-text">Ready</span>}
                    </div>
                    <div className="t-small text-muted">
                      {cap.targets.map((t) => `${t.name} ${t.currentDepth}→${t.depth}${t.status === 'unverified' ? ' (expected)' : ''}`).join(' · ')}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {plan && (
            <Section title={`Next session: ${plan.title}`}>
              <p className="m-0 text-secondary">{plan.orientation}</p>
              {plan.steps.length > 0 && (
                <ul className="list-card">
                  {plan.steps.map((s) => (
                    <li key={s.nodeId} className="flex flex-col gap-[4px]">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-soft">{s.why}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="t-small m-0 text-muted">
                {plan.candidateCount} ideas are learnable now or soon.
                {plan.unreachableTargets.length > 0 && ` Not reachable yet: ${plan.unreachableTargets.map((u) => u.name).join(', ')}.`}
              </p>
            </Section>
          )}
        </>
      )}
      {goals.length === 0 && <Empty>No goals yet.</Empty>}
    </Screen>
  );
}
