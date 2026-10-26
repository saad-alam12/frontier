import { useCallback, useEffect, useState } from 'react';
import { call } from '../api';
import type { GoalDetail, LearnerResponse, PublicCard, SessionSnapshot, Stage } from '../../backend/api/contract';
import { Button, Empty, Page, inputClass } from '../components/Page';
import { Markdown } from '../components/Markdown';

const STAGE_LABEL: Record<Stage, string> = {
  predict: 'Predict',
  explain: 'Explain',
  check: 'Check',
  derive: 'Derive',
  connect: 'Connect',
  compress: 'Compress',
  use: 'Use',
  index: 'Index pass',
  support: 'Worked example',
};

export function SessionScreen() {
  const [snap, setSnap] = useState<SessionSnapshot | null | undefined>(undefined);
  const [goals, setGoals] = useState<GoalDetail[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const current = await call('session.current');
    setSnap(current);
    if (!current) setGoals(await call('goals.list'));
  }, []);

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

  const start = (goalId: string) => run('start', async () => setSnap(await call('session.start', { goalId })));
  const send = (response: LearnerResponse) =>
    run('respond', async () => {
      if (!snap) return;
      setSnap(await call('session.respond', { sessionId: snap.id, response }));
    });
  const abandon = () =>
    run('abandon', async () => {
      if (!snap) return;
      await call('session.abandon', { sessionId: snap.id });
      await refresh();
    });

  if (snap === undefined) return <Page title="Session" />;

  if (!snap) {
    const ready = goals.filter((g) => g.goal.status === 'active' && g.capabilities.length > 0);
    return (
      <Page title="Session" subtitle="One goal per session. The system has already chosen what to do; you press start.">
        {error && <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {ready.length === 0 ? (
          <Empty>Add and compile a goal first, under Goals.</Empty>
        ) : (
          <ul className="space-y-2">
            {ready.map((g) => (
              <li key={g.goal.id} className="flex items-center justify-between rounded-lg border border-stone-200 bg-white p-4">
                <div>
                  <div className="text-sm font-medium">{g.goal.text}</div>
                  <div className="text-xs text-stone-500">{g.capabilities.length} capabilities</div>
                </div>
                <Button kind="primary" onClick={() => void start(g.goal.id)} disabled={busy !== null}>
                  {busy === 'start' ? 'Planning…' : 'Start session'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Page>
    );
  }

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-6">
          <header className="mb-6 flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-stone-500">{snap.goalText}</div>
              <h1 className="text-2xl font-semibold tracking-tight">{snap.plan.title}</h1>
            </div>
            {snap.status === 'active' && (
              <Button onClick={() => void abandon()} disabled={busy !== null}>
                Leave session
              </Button>
            )}
          </header>
          {error && <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          <PhaseView snap={snap} busy={busy !== null} onSend={send} onLeave={() => void refresh()} />
        </div>
      </div>
      <LessonMap snap={snap} />
    </div>
  );
}

function PhaseView({ snap, busy, onSend, onLeave }: { snap: SessionSnapshot; busy: boolean; onSend: (r: LearnerResponse) => void; onLeave: () => void }) {
  switch (snap.phase) {
    case 'reconstruct':
      return (
        <RecallForm
          title="Reconstruct"
          intro={`Before anything new: last session covered ${snap.previousNodes.length} idea${snap.previousNodes.length === 1 ? '' : 's'}. List or sketch, from memory, what you remember. Two or three minutes, no looking back.`}
          busy={busy}
          onSend={onSend}
          submitLabel="Compare with the map"
        />
      );
    case 'orient':
      return (
        <section className="space-y-4">
          <Card title="Today">
            <p className="text-[15px]">{snap.plan.orientation}</p>
            <ol className="mt-3 space-y-1 text-sm">
              {snap.plan.steps.map((s, i) => (
                <li key={s.nodeId}>
                  <span className="text-stone-400">{i + 1}.</span> <span className="font-medium">{s.name}</span> <span className="text-stone-500">— {s.why}</span>
                </li>
              ))}
            </ol>
          </Card>
          <Button kind="primary" onClick={() => onSend({ answer: '' })} disabled={busy}>
            {busy ? 'Preparing the first step…' : 'Begin'}
          </Button>
        </section>
      );
    case 'teach':
      return <TeachView snap={snap} busy={busy} onSend={onSend} />;
    case 'close':
      return (
        <RecallForm
          title="Close"
          intro="Every idea from today, from memory, as a list or a map. Then one line on what you can now do."
          busy={busy}
          onSend={onSend}
          submitLabel="Finish recall"
        />
      );
    case 'preview':
      return (
        <section className="space-y-4">
          <Card title="What you can do now">
            <p className="text-[15px]">{snap.closing?.canDo}</p>
            {snap.closing && snap.closing.recall.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {snap.closing.recall.map((r) => (
                  <li key={r.nodeId} className="flex items-center gap-2">
                    <ScorePill score={r.score} />
                    <span>{r.name}</span>
                    {r.note && <span className="text-stone-500">— {r.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {snap.closing?.previewQuestion && (
            <Card title="Tomorrow opens with">
              <Markdown text={snap.closing.previewQuestion} />
              <p className="mt-2 text-xs text-stone-500">No need to answer now. Let it sit.</p>
            </Card>
          )}
          <Button kind="primary" onClick={() => onSend({ answer: '' })} disabled={busy}>
            {busy ? 'Saving…' : 'Finish session'}
          </Button>
        </section>
      );
    case 'done':
      return (
        <section className="space-y-4">
          <Card title="Session complete">
            <p className="text-[15px]">{snap.closing?.canDo || 'Evidence and your own words are saved.'}</p>
          </Card>
          <Button kind="primary" onClick={onLeave}>
            Done
          </Button>
        </section>
      );
  }
}

function TeachView({ snap, busy, onSend }: { snap: SessionSnapshot; busy: boolean; onSend: (r: LearnerResponse) => void }) {
  const card = snap.card;
  const current = snap.current;
  const [answer, setAnswer] = useState('');
  const [confidence, setConfidence] = useState(0.5);
  const [thinkAloud, setThinkAloud] = useState('');
  const [handle, setHandle] = useState('');
  const [effort, setEffort] = useState<number | null>(null);
  const cardKey = `${current?.nodeId}:${current?.stage}:${current?.stageIndex}`;
  const [lastKey, setLastKey] = useState(cardKey);
  if (cardKey !== lastKey) {
    setLastKey(cardKey);
    setAnswer('');
    setConfidence(0.5);
    setThinkAloud('');
    setHandle('');
    setEffort(null);
  }
  if (!card || !current) return <Empty>Preparing the next card…</Empty>;

  const submit = () => onSend({ answer, confidence, thinkAloud, handle: handle || undefined });
  const grade = snap.lastGrade;

  return (
    <section className="space-y-4">
      {grade && (
        <div className={'rounded-lg border p-4 ' + (grade.confidentlyWrong ? 'border-red-300 bg-red-50' : 'border-stone-200 bg-stone-50')}>
          <div className="mb-1 flex items-center gap-2 text-sm">
            <ScorePill score={grade.score} />
            {grade.confidentlyWrong && <span className="text-xs font-medium text-red-700">Confidently wrong. Worth a second look.</span>}
          </div>
          <Markdown text={grade.feedback} className="text-sm" />
          {grade.misconception && <p className="mt-1 text-xs text-red-700">Noted as a misconception to repair: {grade.misconception}</p>}
        </div>
      )}
      <Card title={STAGE_LABEL[card.stage]} subtitle={current.why}>
        <CardBody card={card} />
      </Card>
      {busy ? (
        <p className="text-sm text-stone-500">Thinking…</p>
      ) : card.stage === 'explain' || card.stage === 'support' ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-stone-600">How hard was that to follow?</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setEffort(n)}
              className={'h-8 w-8 rounded-full border text-sm ' + (effort === n ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white')}
            >
              {n}
            </button>
          ))}
          <Button kind="primary" onClick={() => onSend({ answer: '', effort: effort ?? undefined })}>
            Continue
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <textarea
            className={inputClass}
            rows={card.stage === 'compress' ? 3 : 5}
            placeholder={card.stage === 'compress' ? 'In your own words, at most two sentences' : 'Your answer'}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          {card.stage === 'compress' && <input className={inputClass} placeholder="Handle (optional): a one-line compression, image or mnemonic" value={handle} onChange={(e) => setHandle(e.target.value)} />}
          {card.stage !== 'compress' && card.stage !== 'connect' && (
            <>
              <label className="flex items-center gap-3 text-sm text-stone-600">
                Confidence
                <input type="range" min={0} max={1} step={0.1} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} />
                {Math.round(confidence * 100)}%
              </label>
              <textarea className={inputClass} rows={2} placeholder="Think aloud (optional): how are you getting there?" value={thinkAloud} onChange={(e) => setThinkAloud(e.target.value)} />
            </>
          )}
          <Button kind="primary" onClick={submit} disabled={!answer.trim()}>
            Submit
          </Button>
        </div>
      )}
    </section>
  );
}

function CardBody({ card }: { card: PublicCard }) {
  switch (card.stage) {
    case 'predict':
    case 'connect':
    case 'compress':
    case 'derive':
      return <Markdown text={card.prompt} />;
    case 'explain':
    case 'support':
      return <Markdown text={card.markdown} />;
    case 'check':
      return <Markdown text={card.question} />;
    case 'use':
      return <Markdown text={card.task} />;
    case 'index':
      return (
        <div className="space-y-3">
          <Markdown text={card.gist} />
          <p className="text-sm text-stone-600">{card.placement}</p>
          <div className="border-t border-stone-200 pt-3">
            <Markdown text={card.question} />
          </div>
        </div>
      );
  }
}

function RecallForm({ title, intro, busy, onSend, submitLabel }: { title: string; intro: string; busy: boolean; onSend: (r: LearnerResponse) => void; submitLabel: string }) {
  const [text, setText] = useState('');
  return (
    <section className="space-y-4">
      <Card title={title}>
        <p className="text-[15px]">{intro}</p>
      </Card>
      <textarea className={inputClass} rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="From memory…" disabled={busy} />
      <Button kind="primary" onClick={() => onSend({ answer: text })} disabled={busy}>
        {busy ? 'Comparing…' : submitLabel}
      </Button>
    </section>
  );
}

function LessonMap({ snap }: { snap: SessionSnapshot }) {
  return (
    <aside className="w-64 shrink-0 overflow-y-auto border-l border-stone-200 bg-white p-4">
      <div className="mb-3 text-xs font-medium uppercase tracking-wide text-stone-500">Lesson map</div>
      <ol className="space-y-2">
        {snap.plan.steps.map((s) => {
          const active = snap.current?.nodeId === s.nodeId;
          return (
            <li key={s.nodeId} className="text-sm">
              <div className="flex items-start gap-2">
                <span
                  className={
                    'mt-1 h-2.5 w-2.5 shrink-0 rounded-full ' +
                    (s.status === 'done' ? 'bg-green-600' : active ? 'bg-stone-900 ring-2 ring-stone-300' : 'bg-stone-300')
                  }
                />
                <div>
                  <div className={active ? 'font-medium' : 'text-stone-700'}>{s.name}</div>
                  <div className="text-[11px] uppercase text-stone-400">{s.mode === 'index' ? 'index pass' : s.mode === 'derive' ? 'teach + derive' : 'teach'}</div>
                  {active && snap.current && (
                    <div className="mt-1 text-xs text-stone-500">
                      {STAGE_LABEL[snap.current.stage]} · step {snap.current.stageIndex + 1} of {snap.current.stageCount}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-6 text-xs text-stone-500">
        {snap.phase === 'teach' && 'Everything you type becomes evidence. Your own words are never rewritten.'}
        {snap.phase === 'reconstruct' && 'Recall first, then the map shows what came back.'}
      </div>
    </aside>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500">{title}</h2>
        {subtitle && <span className="truncate text-xs text-stone-400">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function ScorePill({ score }: { score: number }) {
  const tone = score >= 0.7 ? 'bg-green-50 text-green-700' : score >= 0.4 ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700';
  return <span className={'rounded px-1.5 py-0.5 text-[11px] font-medium ' + tone}>{Math.round(score * 10)}/10</span>;
}
