import { useCallback, useEffect, useState } from 'react';
import { call } from '../api';
import type { GoalDetail, LearnerResponse, PublicCard, SessionSnapshot, Stage } from '../../backend/api/contract';
import { Screen, type ScreenName } from '../components/Shell';
import { Button, Empty, Notice } from '../components/controls';
import { Markdown } from '../components/Markdown';
import { AnswerActions, AnswerSurface } from '../components/AnswerSurface';
import { useDrafts } from '../hooks/useDrafts';

const EFFORT_LABELS = ['Easy', 'Fine', 'Took effort', 'Hard', 'Lost me'];

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

export function SessionScreen({ onNavigate }: { onNavigate: (s: ScreenName) => void }) {
  const onLeave = () => onNavigate('today');
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
  const [confirmEnd, setConfirmEnd] = useState(false);
  const pause = () =>
    run('pause', async () => {
      if (!snap) return;
      await call('session.pause', { sessionId: snap.id });
      onLeave();
    });
  const end = () =>
    run('end', async () => {
      if (!snap) return;
      await call('session.end', { sessionId: snap.id });
      setConfirmEnd(false);
      await refresh();
    });

  if (snap === undefined) return <Screen>{null}</Screen>;

  if (!snap) {
    const ready = goals.filter((g) => g.goal.status === 'active' && g.capabilities.length > 0);
    return (
      <Screen>
        <div className="flex flex-col gap-[14px]">
          <h1 className="t-display">Session</h1>
          <p className="t-lead m-0">One goal per session. What to learn is already chosen; you press start.</p>
        </div>
        {error && <Notice error>{error}</Notice>}
        {ready.length === 0 ? (
          <Empty action={<Button onClick={() => onNavigate('goals')}>Go to goals</Button>}>Add and compile a goal first.</Empty>
        ) : (
          <ul className="list-card">
            {ready.map((g) => (
              <li key={g.goal.id} className="row items-center">
                <div>
                  <div>{g.goal.text}</div>
                  <div className="t-small text-muted">{g.capabilities.length} skills</div>
                </div>
                <Button kind="primary" onClick={() => void start(g.goal.id)} disabled={busy !== null}>
                  {busy === 'start' ? 'Planning…' : 'Start session'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Screen>
    );
  }

  return (
    <Screen aside={<LessonMap snap={snap} />} asideLabel="Lesson map">
      <div className="flex flex-col gap-[14px]">
        <div className="section-head">
          <span className="text-[15px] text-secondary">{snap.goalText}</span>
          {snap.status === 'active' && (
            <div className="button-row shrink-0">
              <Button onClick={() => void pause()} disabled={busy !== null}>
                Pause
              </Button>
              {confirmEnd ? (
                <>
                  <span className="t-small text-secondary">End for good? What you learned so far is kept.</span>
                  <Button onClick={() => void end()} disabled={busy !== null}>
                    End session
                  </Button>
                  <Button kind="quiet" onClick={() => setConfirmEnd(false)}>
                    Keep going
                  </Button>
                </>
              ) : (
                <Button kind="quiet" onClick={() => setConfirmEnd(true)} disabled={busy !== null}>
                  End session
                </Button>
              )}
            </div>
          )}
        </div>
        <h1 className="t-display">{snap.plan.title}</h1>
      </div>
      {error && <Notice error>{error}</Notice>}
      <PhaseView snap={snap} busy={busy !== null} onSend={send} onLeave={() => void refresh()} />
    </Screen>
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
        <section className="flex flex-col gap-[24px]">
          <Card title="Today">
            <p className="m-0 text-[15px]">{snap.plan.orientation}</p>
            <ol className="m-0 mt-[14px] flex list-none flex-col gap-[10px] p-0">
              {snap.plan.steps.map((s) => (
                <li key={s.nodeId} className="flex flex-col">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-secondary">{s.why}</span>
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
        <section className="flex flex-col gap-[24px]">
          <Card title="What you can do now">
            <p className="m-0 text-[15px]">{snap.closing?.canDo}</p>
            {snap.closing && snap.closing.recall.length > 0 && (
              <ul className="m-0 mt-[12px] flex list-none flex-col gap-[6px] p-0">
                {snap.closing.recall.map((r) => (
                  <li key={r.nodeId} className="flex items-baseline gap-[10px]">
                    <ScorePill score={r.score} />
                    <span>{r.name}</span>
                    {r.note && <span className="text-muted">{r.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {snap.closing?.previewQuestion && (
            <Card title="Tomorrow opens with">
              <Markdown text={snap.closing.previewQuestion} />
              <p className="t-small m-0 mt-[10px] text-muted">No need to answer now. Let it sit.</p>
            </Card>
          )}
          <Button kind="primary" onClick={() => onSend({ answer: '' })} disabled={busy}>
            {busy ? 'Saving…' : 'Finish session'}
          </Button>
        </section>
      );
    case 'done':
      return (
        <section className="flex flex-col gap-[24px]">
          <Card title="Session complete">
            <p className="m-0 text-[15px]">{snap.closing?.canDo || 'Evidence and your own words are saved.'}</p>
          </Card>
          <Button kind="primary" onClick={onLeave}>
            Done
          </Button>
        </section>
      );
  }
}

type CardDraft = { answer: string; confidence: number | null; handle: string };
const EMPTY_CARD_DRAFT: CardDraft = { answer: '', confidence: null, handle: '' };

function TeachView({ snap, busy, onSend }: { snap: SessionSnapshot; busy: boolean; onSend: (r: LearnerResponse) => void }) {
  const card = snap.card;
  const current = snap.current;
  const [effort, setEffort] = useState<number | null>(null);
  const draftKey = `session:${snap.id}:${current?.nodeId}:${current?.stage}:${current?.stageIndex}`;
  const drafts = useDrafts<CardDraft>([draftKey], EMPTY_CARD_DRAFT);
  const draft = drafts.values[draftKey] ?? EMPTY_CARD_DRAFT;
  const [lastKey, setLastKey] = useState(draftKey);
  if (draftKey !== lastKey) {
    setLastKey(draftKey);
    setEffort(null);
  }
  if (!card || !current) return <Empty>Preparing the next card…</Empty>;

  const set = (patch: Partial<CardDraft>) => drafts.set(draftKey, { ...draft, ...patch });
  const send = (answer: string) => {
    if (busy) return;
    drafts.set(draftKey, EMPTY_CARD_DRAFT);
    onSend({ answer, confidence: draft.confidence ?? undefined, handle: draft.handle.trim() || undefined });
  };
  const grade = snap.lastGrade;
  const asksConfidence = card.stage !== 'compress' && card.stage !== 'connect';

  return (
    <section className="flex flex-col gap-[24px]">
      {grade && (
        <div className="flex flex-col gap-[6px]">
          <div className="flex items-baseline gap-[10px]">
            <ScorePill score={grade.score} />
            {grade.confidentlyWrong && <span className="t-small text-secondary">Confidently wrong. Worth a second look.</span>}
          </div>
          <Markdown text={grade.feedback} className="text-soft" />
          {grade.misconception && <p className="t-small m-0 text-secondary">Noted to repair: {grade.misconception}</p>}
        </div>
      )}
      <Card title={STAGE_LABEL[card.stage]}>
        <CardBody card={card} />
      </Card>
      {busy ? (
        <p className="t-small m-0 text-muted">Thinking…</p>
      ) : card.stage === 'explain' || card.stage === 'support' ? (
        <div className="flex flex-col gap-[18px]">
          <div className="flex flex-col gap-[12px]">
            <span className="text-[15px] text-secondary">How hard was that to follow?</span>
            <div role="radiogroup" aria-label="How hard was that to follow" className="chip-group">
              {EFFORT_LABELS.map((label, i) => (
                <button key={label} type="button" role="radio" aria-checked={effort === i + 1} className="chip" onClick={() => setEffort(i + 1)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="button-row">
            <Button kind="primary" onClick={() => onSend({ answer: '', effort: effort ?? undefined })}>
              Continue
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-[18px]">
          <AnswerSurface
            value={draft.answer}
            onChange={(answer) => set({ answer })}
            onSubmit={() => send(draft.answer)}
            confidence={asksConfidence ? draft.confidence : undefined}
            onConfidence={asksConfidence ? (confidence) => set({ confidence }) : undefined}
            placeholder={card.stage === 'compress' ? 'In your own words, at most two sentences.' : undefined}
            rows={card.stage === 'compress' ? 3 : 4}
          />
          {card.stage === 'compress' && (
            <input className="input" aria-label="Handle" placeholder="Handle (optional): a one-line compression, image or mnemonic" value={draft.handle} onChange={(e) => set({ handle: e.target.value })} />
          )}
          <AnswerActions onSubmit={() => send(draft.answer)} onNoIdea={() => send('')} />
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
        <div className="flex flex-col gap-[18px]">
          <Markdown text={card.gist} />
          <p className="m-0 text-secondary">{card.placement}</p>
          <Markdown text={card.question} />
        </div>
      );
  }
}

function RecallForm({ title, intro, busy, onSend, submitLabel }: { title: string; intro: string; busy: boolean; onSend: (r: LearnerResponse) => void; submitLabel: string }) {
  const [text, setText] = useState('');
  const submit = () => !busy && onSend({ answer: text });
  return (
    <section className="flex flex-col gap-[24px]">
      <Card title={title}>
        <p className="m-0 text-[15px]">{intro}</p>
      </Card>
      <AnswerSurface value={text} onChange={setText} onSubmit={submit} placeholder="From memory, however it comes." rows={8} disabled={busy} />
      <div className="answer-actions">
        <Button kind="primary" onClick={submit} disabled={busy}>
          {busy ? 'Comparing…' : submitLabel}
        </Button>
        <span className="keyboard-hint">⌘↵ to submit</span>
      </div>
    </section>
  );
}

function LessonMap({ snap }: { snap: SessionSnapshot }) {
  return (
    <>
      <h2 className="t-title">Lesson map</h2>
      <ol className="m-0 flex list-none flex-col gap-[14px] p-0">
        {snap.plan.steps.map((s) => {
          const active = snap.current?.nodeId === s.nodeId;
          return (
            <li key={s.nodeId} className="flex gap-[14px]">
              <span className={`dot mt-[5px] ${s.status === 'done' ? 'is-done' : active ? 'is-current' : 'is-upcoming'}`} aria-hidden="true" />
              <div>
                <div className={active ? 'font-medium' : 'text-soft'}>{s.name}</div>
                <div className="t-caption text-muted">{s.mode === 'index' ? 'Index pass' : s.mode === 'derive' ? 'Teach and derive' : 'Teach'}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="t-caption text-muted">{title}</div>
      <div className="text-[16px]">{children}</div>
    </div>
  );
}

function ScorePill({ score }: { score: number }) {
  return <span className="font-medium text-text">{Math.round(score * 10)}/10</span>;
}
