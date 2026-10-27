import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { call } from '../api';
import type { GoalDetail, HistoryItem, HistoryNode, LearnerResponse, PublicCard, SessionSnapshot, Stage } from '../../backend/api/contract';
import { confidenceLabel } from '../../backend/core/types';
import { Breadcrumb, Screen, type ScreenName } from '../components/Shell';
import { Button, Empty, Notice, Section } from '../components/controls';
import { Markdown } from '../components/Markdown';
import { AnswerActions, AnswerSurface } from '../components/AnswerSurface';
import { FrontierPanel } from '../components/FrontierPanel';
import { StepPath, VerticalPath } from '../components/paths';
import { useDrafts } from '../hooks/useDrafts';

const STAGE_LABEL: Record<Stage, string> = {
  predict: 'Predict',
  explain: 'Explain',
  check: 'Check',
  derive: 'Derive',
  connect: 'Connect',
  compress: 'Own words',
  use: 'Use',
  index: 'Index pass',
  support: 'Worked example',
  reteach: 'Another way in',
};

const EFFORT_LABELS = ['Easy', 'Fine', 'Took effort', 'Hard', 'Lost me'];

type CardDraft = { answer: string; confidence: number | null; handle: string };
const EMPTY_CARD_DRAFT: CardDraft = { answer: '', confidence: null, handle: '' };

/** The answer just sent, shown in the conversation while the tutor works. */
type Pending = { card: PublicCard | null; stage: Stage | null; response: LearnerResponse } | null;

export function SessionScreen({ onNavigate }: { onNavigate: (s: ScreenName) => void }) {
  const [snap, setSnap] = useState<SessionSnapshot | null | undefined>(undefined);
  const [goals, setGoals] = useState<GoalDetail[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const mainRef = useRef<HTMLElement>(null);
  const currentRef = useRef<HTMLDivElement>(null);

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
      setPending(null);
    }
  };

  const start = (goalId: string) => run('start', async () => setSnap(await call('session.start', { goalId })));
  const send = (response: LearnerResponse) =>
    run('respond', async () => {
      if (!snap) return;
      setPending({ card: snap.card, stage: snap.current?.stage ?? null, response });
      setSnap(await call('session.respond', { sessionId: snap.id, response }));
    });
  const pause = () =>
    run('pause', async () => {
      if (!snap) return;
      await call('session.pause', { sessionId: snap.id });
      onNavigate('today');
    });
  const end = () =>
    run('end', async () => {
      if (!snap) return;
      await call('session.end', { sessionId: snap.id });
      setConfirmEnd(false);
      await refresh();
    });

  // Keep the current step in view: the newest exchange sits at the bottom, history above it.
  const focusKey = snap ? `${snap.phase}:${snap.current?.nodeId}:${snap.current?.stage}:${historyLength(snap)}:${pending ? 1 : 0}` : '';
  useLayoutEffect(() => {
    const main = mainRef.current;
    const target = currentRef.current;
    if (!main || !target) return;
    const top = target.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
    main.scrollTo({ top: Math.max(0, top - 160) });
  }, [focusKey]);

  const scrollTo = (elementId: string, nodeId?: string) => {
    if (nodeId) setExpanded((prev) => new Set(prev).add(nodeId));
    requestAnimationFrame(() => document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

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
          <Empty action={<Button onClick={() => onNavigate('goals')}>Go to goals</Button>}>Add a goal first. Its first session is planned from your material.</Empty>
        ) : (
          <ul className="list-card">
            {ready.map((g) => (
              <li key={g.goal.id} className="row items-center">
                <div className="flex min-w-0 flex-col">
                  <span>{g.goal.title ?? g.goal.text}</span>
                  <span className="t-small text-muted">{g.capabilities.length} skills</span>
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

  const isBusy = busy !== null;
  const current = snap.current;
  const crumbs = [{ label: snap.goalTitle, onClick: () => onNavigate('goals') }, { label: snap.plan.title }, ...(current ? [{ label: current.name }] : [])];
  const panel = current && snap.frontier ? <FrontierPanel map={snap.frontier} why={current.why} onSelect={(id) => scrollTo(`node-${id}`, id)} /> : <PlanPanel snap={snap} />;

  return (
    <Screen aside={panel} asideLabel={current ? 'Your frontier' : "Today's plan"} asideGap={current ? 22 : 28} mainRef={mainRef}>
      <div className="flex flex-col gap-[26px]">
        <Breadcrumb items={crumbs} />
        {snap.phase === 'teach' && current && current.stageCount > 1 && (
          <StepPath
            steps={current.stages.map((stage, i) => ({
              key: stage,
              label: STAGE_LABEL[stage],
              state: i < current.stageIndex ? 'done' : i === current.stageIndex ? 'current' : 'upcoming',
              onClick: () => scrollTo(`step-${current.nodeId}-${stage}`),
            }))}
          />
        )}
      </div>

      {error && <Notice error>{error}</Notice>}

      <History snap={snap} expanded={expanded} onToggle={(id) => setExpanded((prev) => toggle(prev, id))} />

      {pending?.card && pending.stage && <Exchange id="pending" item={{ id: 'pending', stage: pending.stage, card: pending.card, response: pending.response, grade: null, carried: false }} thinking />}

      <div ref={currentRef} className="flex flex-col gap-[36px]">
        {pending && !pending.card && <p className="t-small m-0 text-muted">Thinking…</p>}
        {!pending && <PhaseView snap={snap} busy={isBusy} onSend={send} onDone={() => void refresh()} />}
      </div>

      {snap.status === 'active' && (
        <div className="button-row gap-[18px] border-t border-line pt-[18px]">
          {confirmEnd ? (
            <>
              <span className="t-small text-secondary">End this session? What you learned is kept, and next time you continue this idea where you stopped.</span>
              <Button kind="quiet" onClick={() => void end()} disabled={isBusy}>
                End session
              </Button>
              <Button kind="quiet" onClick={() => setConfirmEnd(false)}>
                Keep going
              </Button>
            </>
          ) : (
            <>
              <Button kind="quiet" onClick={() => void pause()} disabled={isBusy}>
                Pause and come back later
              </Button>
              <Button kind="quiet" onClick={() => setConfirmEnd(true)} disabled={isBusy}>
                End session
              </Button>
            </>
          )}
        </div>
      )}
    </Screen>
  );
}

function historyLength(snap: SessionSnapshot): number {
  return snap.history.nodes.reduce((n, h) => n + h.items.length, 0);
}

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Everything already said, oldest first. Finished ideas collapse to one row; the current idea stays open. */
function History({ snap, expanded, onToggle }: { snap: SessionSnapshot; expanded: Set<string>; onToggle: (nodeId: string) => void }) {
  const { reconstruct, nodes } = snap.history;
  if (!reconstruct && nodes.length === 0) return null;
  return (
    <div className="flex flex-col gap-[36px]">
      {reconstruct && (
        <article className="flex flex-col gap-[14px]">
          <div className="t-caption text-muted">Recall from last time</div>
          <div className="answer-block learner-text whitespace-pre-wrap">{reconstruct.text.trim() || <span className="text-muted">Nothing came back</span>}</div>
          <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
            {reconstruct.recalled.map((r) => (
              <li key={r.nodeId} className="flex items-baseline gap-[10px]">
                <span className="shrink-0 font-medium">{Math.round(r.score * 10)}/10</span>
                <Markdown text={r.name} inline />
                {r.note && <span className="text-soft">{r.note}</span>}
              </li>
            ))}
          </ul>
        </article>
      )}
      {nodes.length > 0 && (
        <div className="flex flex-col">
          {nodes.map((node) => (
            <HistoryNodeView key={node.nodeId} node={node} open={node.status !== 'done' || expanded.has(node.nodeId)} onToggle={() => onToggle(node.nodeId)} />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryNodeView({ node, open, onToggle }: { node: HistoryNode; open: boolean; onToggle: () => void }) {
  const collapsible = node.status === 'done';
  return (
    <section id={`node-${node.nodeId}`} className={collapsible ? 'history-node is-done' : 'history-node'} aria-label={node.name}>
      {collapsible && (
        <button type="button" className="history-row" aria-expanded={open} onClick={onToggle}>
          <Markdown text={node.name} inline className="font-medium" />
          <span className="flex items-center gap-[12px]">
            {node.score !== null && <span>{Math.round(node.score * 10)}/10</span>}
            <span className={open ? 'chevron is-open' : 'chevron'} aria-hidden="true" />
          </span>
        </button>
      )}
      {open && node.items.length > 0 && (
        <div className="history-items">
          {node.items.map((item) => (
            <Exchange key={item.id} id={`step-${node.nodeId}-${item.stage}`} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

/** One past step: the card as shown, the learner's answer exactly as given, then the rating. */
function Exchange({ id, item, thinking }: { id: string; item: HistoryItem; thinking?: boolean }) {
  const read = isReading(item.card.stage);
  const effort = item.response?.effort;
  const meta = item.response
    ? [item.response.confidence !== undefined ? capitalize(confidenceLabel(item.response.confidence)) : null, item.response.handle ? `Handle: ${item.response.handle}` : null].filter(Boolean).join(' · ')
    : '';
  return (
    <article id={id} className="flex flex-col gap-[14px]">
      <div className="t-caption text-muted">{item.carried && item.response ? `${STAGE_LABEL[item.stage]} · last session` : STAGE_LABEL[item.stage]}</div>
      <CardText card={item.card} past />
      {!read && item.response && (
        <div className="answer-block flex flex-col gap-[8px]">
          {item.response.answer.trim() ? <div className="learner-text whitespace-pre-wrap">{item.response.answer}</div> : <div className="learner-text text-muted">No idea</div>}
          {meta && <div className="t-caption text-muted">{meta}</div>}
        </div>
      )}
      {read && effort !== undefined && <div className="t-caption text-muted">{EFFORT_LABELS[effort - 1]}</div>}
      {item.grade && (
        <div className="flex flex-col gap-[6px]">
          <div className="flex items-baseline gap-[10px]">
            <span className="font-medium">{Math.round(item.grade.score * 10)}/10</span>
            {item.grade.confidentlyWrong && <span className="t-small text-secondary">Confidently wrong, worth a second look</span>}
          </div>
          <Markdown text={item.grade.feedback} className="text-soft" />
          {item.grade.misconception && <p className="t-small m-0 text-secondary">Noted to repair: {item.grade.misconception}</p>}
        </div>
      )}
      {thinking && <p className="t-small m-0 text-muted">Thinking…</p>}
    </article>
  );
}

/** Cards the learner reads and rates, rather than answers. */
function isReading(stage: Stage): boolean {
  return stage === 'explain' || stage === 'support' || stage === 'reteach';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A card's text. The current question uses the Question style; past ones and explanations use body text. */
function CardText({ card, past }: { card: PublicCard; past?: boolean }) {
  const question = past ? 'text-[15px]' : 't-question';
  const prose = past ? 'text-[15px] text-soft' : 'text-[16px] leading-[1.6] text-soft';
  switch (card.stage) {
    case 'predict':
    case 'connect':
    case 'compress':
    case 'derive':
      return <Markdown text={card.prompt} className={question} />;
    case 'check':
      return <Markdown text={card.question} className={question} />;
    case 'use':
      return <Markdown text={card.task} className={question} />;
    case 'explain':
    case 'support':
    case 'reteach':
      return <Markdown text={card.markdown} className={prose} />;
    case 'index':
      return (
        <div className="flex flex-col gap-[18px]">
          <Markdown text={card.gist} className={prose} />
          <p className="m-0 text-secondary">{card.placement}</p>
          <Markdown text={card.question} className={question} />
        </div>
      );
  }
}

function PhaseView({ snap, busy, onSend, onDone }: { snap: SessionSnapshot; busy: boolean; onSend: (r: LearnerResponse) => void; onDone: () => void }) {
  switch (snap.phase) {
    case 'reconstruct':
      return (
        <RecallStep
          sessionId={snap.id}
          prompt={`Before anything new: last session covered ${snap.previousNodes.length} idea${snap.previousNodes.length === 1 ? '' : 's'}. From memory, list or sketch what you remember. Two or three minutes, no looking back.`}
          submitLabel="Compare with the map"
          busy={busy}
          onSend={onSend}
        />
      );
    case 'orient':
      return (
        <section className="flex flex-col gap-[28px]">
          <div className="flex flex-col gap-[14px]">
            <h1 className="t-display">{snap.plan.title}</h1>
            <p className="t-lead m-0">{snap.plan.orientation}</p>
          </div>
          <ul className="list-card">
            {snap.plan.steps.map((s) => (
              <li key={s.nodeId} className="flex flex-col gap-[2px]">
                <Markdown text={s.name} inline className="font-medium" />
                <span className="text-soft">{s.why}</span>
              </li>
            ))}
          </ul>
          <div className="button-row">
            <Button kind="primary" onClick={() => onSend({ answer: '' })} disabled={busy}>
              {busy ? 'Preparing the first step…' : 'Begin'}
            </Button>
          </div>
        </section>
      );
    case 'teach':
      return <TeachStep snap={snap} busy={busy} onSend={onSend} />;
    case 'close':
      return <RecallStep sessionId={snap.id} prompt="Every idea from today, from memory, as a list or a map. Then one line on what you can now do." submitLabel="Finish recall" busy={busy} onSend={onSend} />;
    case 'preview':
      return (
        <section className="flex flex-col gap-[36px]">
          <Section title="What you can do now">
            <p className="t-lead m-0">{snap.closing?.canDo}</p>
            {snap.closing && snap.closing.recall.length > 0 && (
              <ul className="list-card">
                {snap.closing.recall.map((r) => (
                  <li key={r.nodeId} className="flex flex-col gap-[2px]">
                    <span className="row">
                      <Markdown text={r.name} inline />
                      <span className="shrink-0">{Math.round(r.score * 10)}/10</span>
                    </span>
                    {r.note && <span className="t-small text-secondary">{r.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {snap.closing?.previewQuestion && (
            <Section title="Tomorrow opens with">
              <Markdown text={snap.closing.previewQuestion} className="t-question" />
              <p className="t-small m-0 text-muted">No need to answer now. Let it sit.</p>
            </Section>
          )}
          <div className="button-row">
            <Button kind="primary" onClick={() => onSend({ answer: '' })} disabled={busy}>
              {busy ? 'Saving…' : 'Finish session'}
            </Button>
          </div>
        </section>
      );
    case 'done':
      return (
        <section className="flex flex-col gap-[28px]">
          <p className="t-lead m-0">{snap.closing?.canDo || 'Evidence and your own words are saved.'}</p>
          <div className="button-row">
            <Button kind="primary" onClick={onDone}>
              Done
            </Button>
          </div>
        </section>
      );
  }
}

function TeachStep({ snap, busy, onSend }: { snap: SessionSnapshot; busy: boolean; onSend: (r: LearnerResponse) => void }) {
  const card = snap.card;
  const current = snap.current;
  const [effort, setEffort] = useState<number | null>(null);
  const draftKey = `session:${snap.id}:${current?.nodeId}:${current?.stage}:${historyLength(snap)}`;
  const drafts = useDrafts<CardDraft>([draftKey], EMPTY_CARD_DRAFT);
  const draft = drafts.values[draftKey] ?? EMPTY_CARD_DRAFT;
  const [lastKey, setLastKey] = useState(draftKey);
  if (draftKey !== lastKey) {
    setLastKey(draftKey);
    setEffort(null);
  }
  if (!card || !current) return <p className="t-small m-0 text-muted">Preparing the next step…</p>;

  const set = (patch: Partial<CardDraft>) => drafts.set(draftKey, { ...draft, ...patch });
  const send = (answer: string) => {
    if (busy) return;
    drafts.set(draftKey, EMPTY_CARD_DRAFT);
    onSend({ answer, confidence: draft.confidence ?? undefined, handle: draft.handle.trim() || undefined });
  };

  if (isReading(card.stage)) {
    return (
      <section className="flex flex-col gap-[32px]">
        <CardText card={card} />
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
          <Button kind="primary" onClick={() => onSend({ answer: '', effort: effort ?? undefined })} disabled={busy}>
            Continue
          </Button>
        </div>
      </section>
    );
  }

  const asksConfidence = card.stage !== 'compress' && card.stage !== 'connect';
  return (
    <section className="flex flex-col gap-[32px]">
      <CardText card={card} />
      <div className="flex flex-col gap-[14px]">
        <AnswerSurface
          value={draft.answer}
          onChange={(answer) => set({ answer })}
          onSubmit={() => send(draft.answer)}
          confidence={asksConfidence ? draft.confidence : undefined}
          onConfidence={asksConfidence ? (confidence) => set({ confidence }) : undefined}
          placeholder={card.stage === 'compress' ? 'In your own words, at most two sentences.' : undefined}
          rows={card.stage === 'compress' ? 3 : 4}
          disabled={busy}
        />
        {card.stage === 'compress' && (
          <input className="input" aria-label="Handle" placeholder="A handle, if you like: a short phrase, image or mnemonic" value={draft.handle} onChange={(e) => set({ handle: e.target.value })} />
        )}
      </div>
      <AnswerActions onSubmit={() => send(draft.answer)} onNoIdea={() => send('')} disabled={busy} />
    </section>
  );
}

function RecallStep({ sessionId, prompt, submitLabel, busy, onSend }: { sessionId: string; prompt: string; submitLabel: string; busy: boolean; onSend: (r: LearnerResponse) => void }) {
  const key = `session:${sessionId}:recall:${submitLabel}`;
  const drafts = useDrafts<CardDraft>([key], EMPTY_CARD_DRAFT);
  const text = (drafts.values[key] ?? EMPTY_CARD_DRAFT).answer;
  const submit = () => {
    if (busy) return;
    drafts.set(key, EMPTY_CARD_DRAFT);
    onSend({ answer: text });
  };
  return (
    <section className="flex flex-col gap-[32px]">
      <p className="t-question">{prompt}</p>
      <AnswerSurface value={text} onChange={(answer) => drafts.set(key, { ...EMPTY_CARD_DRAFT, answer })} onSubmit={submit} placeholder="From memory, however it comes." rows={6} disabled={busy} />
      <div className="answer-actions">
        <Button kind="primary" onClick={submit} disabled={busy}>
          {busy ? 'Comparing…' : submitLabel}
        </Button>
        <span className="keyboard-hint">⌘↵ to submit</span>
      </div>
    </section>
  );
}

/** Outside the step loop the panel shows today's plan as a path. */
function PlanPanel({ snap }: { snap: SessionSnapshot }) {
  return (
    <>
      <h2 className="t-title">Today&rsquo;s plan</h2>
      <VerticalPath
        items={snap.plan.steps.map((s) => ({
          key: s.nodeId,
          state: s.status === 'done' ? 'done' : s.status === 'active' ? 'current' : 'upcoming',
          children: (
            <div className="flex flex-col gap-[2px]">
              <Markdown text={s.name} inline className={s.status === 'pending' ? 'text-secondary' : ''} />
              <span className="t-small text-muted">{s.mode === 'index' ? 'Index pass' : s.mode === 'derive' ? 'Teach and derive' : 'Teach'}</span>
            </div>
          ),
        }))}
      />
    </>
  );
}
