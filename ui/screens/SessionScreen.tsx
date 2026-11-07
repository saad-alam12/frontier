import { plainError } from '../lib/errors';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { call, isCancelled, onEvent } from '../api';
import type { GoalDetail, HistoryItem, HistoryNode, LearnerResponse, PublicCard, SessionSnapshot, Stage } from '../../backend/api/contract';
import { confidenceLabel } from '../../backend/core/types';
import { Breadcrumb, Screen, type ScreenName } from '../components/Shell';
import { Button, Empty, Notice, Section } from '../components/controls';
import { ConfirmDialog } from '../components/Dialog';
import { Markdown } from '../components/Markdown';
import { AnswerActions, AnswerSurface, Thinking } from '../components/AnswerSurface';
import { ResponseExtras, clearAnswerExtras, useAnswerExtras, withExtras } from '../components/AnswerExtras';
import { QuoteReply } from '../components/QuoteReply';
import { CardSheet } from '../components/CardSheet';
import type { CardSheetStart } from '../components/CardSheet';
import { FrontierPanel } from '../components/FrontierPanel';
import { PracticeFlow } from '../components/PracticeFlow';
import { StepPath, VerticalPath } from '../components/paths';
import { useDrafts } from '../hooks/useDrafts';
import { useEscape } from '../hooks/useEscape';
import { STAGE_LABEL, aimLabel } from '../lib/stages';
import { startSessionInBackground, useSessionScreenOpen, useSessionWork } from '../lib/sessionWork';
import type { ChooseInit } from '../components/ChooseSheet';


const EFFORT_LABELS = ['Easy', 'Fine', 'Took effort', 'Hard', 'Lost me'];

type CardDraft = { answer: string; confidence: number | null; handle: string };
const EMPTY_CARD_DRAFT: CardDraft = { answer: '', confidence: null, handle: '' };

/** The answer just sent, shown in the conversation while the tutor works. */
type Pending = { card: PublicCard | null; stage: Stage | null; response: LearnerResponse } | null;

export function SessionScreen({ onNavigate, onChoose }: { onNavigate: (s: ScreenName) => void; onChoose: (init?: ChooseInit) => void }) {
  const [snap, setSnap] = useState<SessionSnapshot | null | undefined>(undefined);
  const [goals, setGoals] = useState<GoalDetail[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  /** The answer this screen just sent, until the backend's work shows it. */
  const [sending, setSending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const { work, last } = useSessionWork();
  useSessionScreenOpen();
  const [confirmEnd, setConfirmEnd] = useState(false);
  /** Set after Esc stopped an answer, so the field comes back focused for editing. */
  const [stopped, setStopped] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** The flashcard sheet, from a selection or the Make a flashcard button. */
  const [cardSheet, setCardSheet] = useState<CardSheetStart | null>(null);
  const [cardSaved, setCardSaved] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const currentRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const current = await call('session.current');
    setSnap(current);
    if (!current) setGoals(await call('goals.list'));
  }, []);

  useEffect(() => {
    void refresh();
    return onEvent('practice.graded', () => void refresh());
  }, [refresh]);
  // a failed start is shown here once, then forgotten, so the sidebar stops offering a session that never opened
  const startFailed = work?.kind === 'start' && work.status === 'failed' ? work.error : null;
  useEffect(() => {
    if (!startFailed) return;
    setError(`The session could not be planned. ${plainError(startFailed)}`);
    void call('session.dismissStart');
  }, [startFailed]);
  // work that finished, here or while the screen was closed, changed the session
  useEffect(() => {
    if (last && last.outcome !== 'running') void refresh();
  }, [last, refresh]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setSending(null);
    }
  };

  /**
   * The draft stays saved until the backend accepts the answer (it deletes it then), so Esc or an
   * error gives it back to edit, also after leaving the screen.
   */
  const send = (response: LearnerResponse, draftKey?: string) =>
    run('respond', async () => {
      if (!snap) return;
      setStopped(false);
      setSending({ card: snap.card, stage: snap.current?.stage ?? null, response });
      try {
        setSnap(await call('session.respond', { sessionId: snap.id, response, draftKey }));
      } catch (e) {
        if (isCancelled(e)) {
          setStopped(true);
          return;
        }
        // the answer may have been judged and saved before a later step failed: the notice says so
        const fresh = await call('session.current');
        setSnap(fresh);
        if (fresh?.owed) return;
        throw new Error(notSent(e instanceof Error ? e.message : String(e)));
      }
      clearAnswerExtras();
    });
  // the backend's work on this session: an answer still being judged, or one that failed
  const mine = snap && work?.sessionId === snap.id ? work : null;
  const judging = mine?.kind === 'respond' && mine.status === 'running' ? mine : null;
  const failed = mine?.status === 'failed' ? mine.error : null;
  const pending: Pending = sending ?? judging?.sent ?? null;
  const asksJudgement = Boolean(snap && pending && (pending.card ? !isReading(pending.card.stage) : snap.phase === 'reconstruct' || snap.phase === 'close'));
  const stoppable = judging ? judging.stoppable : asksJudgement;
  const thinkingLabel = asksJudgement ? 'Judging…' : 'Thinking…';
  const stop = () => {
    if (snap && stoppable) void call('session.cancel', { sessionId: snap.id });
  };
  // with the flashcard sheet open, Esc closes the sheet and leaves the answer being judged alone
  useEscape(stoppable && cardSheet === null, stop);
  useEffect(() => {
    if (!cardSaved) return;
    const t = window.setTimeout(() => setCardSaved(false), 2400);
    return () => window.clearTimeout(t);
  }, [cardSaved]);
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
    const planning = work?.kind === 'start' && work.status === 'running' ? work : null;
    if (planning) {
      const goal = goals.find((g) => g.goal.id === planning.goalId)?.goal;
      return <Planning goalTitle={goal ? (goal.title ?? goal.text) : null} />;
    }
    return (
      <Screen>
        <div className="flex flex-col gap-[14px]">
          <h1 className="t-display">Session</h1>
          <p className="t-lead m-0">Start the session planned for a goal, or choose what to learn yourself.</p>
        </div>
        {error && <Notice error>{error}</Notice>}
        {ready.length === 0 ? (
          <Empty
            action={
              <div className="button-row">
                <Button kind="primary" onClick={() => onChoose()}>
                  Choose what to learn
                </Button>
                <Button onClick={() => onNavigate('goals')}>Set a goal</Button>
              </div>
            }
          >
            No goal has a session ready yet. Choose what to learn now, or set a goal and Frontier plans its sessions.
          </Empty>
        ) : (
          <ul className="list-card">
            {ready.map((g) => (
              <li key={g.goal.id} className="row items-center">
                <div className="flex min-w-0 flex-col">
                  <span>{g.goal.title ?? g.goal.text}</span>
                  <span className="t-small text-muted">{g.capabilities.length} skills</span>
                </div>
                <Button kind="primary" onClick={() => startSessionInBackground(g.goal.id)}>
                  Start session
                </Button>
              </li>
            ))}
          </ul>
        )}
        {ready.length > 0 && (
          <div className="button-row">
            <Button onClick={() => onChoose()}>Choose what to learn</Button>
            <span className="t-small text-muted">Pick ideas from your map, or describe what you want.</span>
          </div>
        )}
      </Screen>
    );
  }

  const isBusy = busy !== null || judging !== null;
  const current = snap.current;
  const notice = error ?? (failed ? (snap.owed ? notWritten(failed) : notSent(failed)) : null);
  // a session named after its one idea shows the name once
  const crumbs = [{ label: snap.goalTitle, onClick: snap.goalId ? () => onNavigate('goals') : undefined }, { label: snap.plan.title }, ...(current && current.name !== snap.plan.title ? [{ label: current.name }] : [])];
  const panel = current && snap.frontier ? <FrontierPanel map={snap.frontier} why={current.why} onSelect={(id) => scrollTo(`node-${id}`, id)} /> : <PlanPanel snap={snap} />;

  return (
    <Screen aside={panel} asideLabel={current ? 'Your frontier' : "Today's plan"} asideGap={current ? 22 : 28} mainRef={mainRef}>
      <div className="flex flex-col gap-[26px]">
        <div className="section-head">
          <Breadcrumb items={crumbs} />
          <button type="button" className="link-button shrink-0" onClick={() => setCardSheet({ mode: 'request' })} aria-live="polite">
            {cardSaved ? 'Flashcard saved' : 'Make a flashcard'}
          </button>
        </div>
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

      <QuoteReply containerRef={mainRef} onMakeCard={(selection) => setCardSheet({ mode: 'selection', selection })} />

      <History snap={snap} expanded={expanded} onToggle={(id) => setExpanded((prev) => toggle(prev, id))} />

      {pending?.card && pending.stage && <Exchange id="pending" item={{ id: 'pending', stage: pending.stage, card: pending.card, response: pending.response, grade: null, carried: false }} onStop={stoppable ? stop : undefined} thinking={thinkingLabel} />}

      <div ref={currentRef} className="flex flex-col gap-[36px]">
        {pending && !pending.card && <Thinking label={thinkingLabel} onStop={stoppable ? stop : undefined} />}
        {!pending && <PhaseView snap={snap} busy={isBusy} refocus={stopped} onSend={send} onDone={() => void refresh()} />}
        {/* next to the answer it is about, where the eyes are */}
        {notice && (
          <Notice error detail={failed ?? undefined}>
            {notice}
          </Notice>
        )}
      </div>

      {snap.status === 'active' && (
        <div className="session-footer">
          <Button kind="secondary" onClick={() => void pause()} disabled={isBusy} title="Leave now and come back to this same session later. Your answers are saved.">
            Pause
          </Button>
          <Button kind="quiet" onClick={() => setConfirmEnd(true)} disabled={isBusy} title="Close this session. Your answers are saved, and the next session starts where you stopped.">
            End session
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirmEnd}
        title="End this session?"
        confirmLabel={busy === 'end' ? 'Ending…' : 'End session'}
        cancelLabel="Keep going"
        busy={busy === 'end'}
        onConfirm={() => void end()}
        onCancel={() => setConfirmEnd(false)}
      >
        <p>Everything you learned so far is kept. Your next session starts where you stopped, at the same step of this idea.</p>
        <p>To come back to this very session instead, choose Pause.</p>
      </ConfirmDialog>
      {cardSheet && <CardSheet start={cardSheet} ideas={sessionIdeas(snap)} goalId={snap.goalId} sessionId={snap.id} onClose={() => setCardSheet(null)} onSaved={() => setCardSaved(true)} />}
    </Screen>
  );
}

/** Why the last answer did not go through; the answer itself is still in the field. */
function notSent(reason: string): string {
  return `Your answer did not go through. ${plainError(reason)} It is still in the field to send again.`;
}

/** Why the card after a saved answer is missing; Try again writes it. */
function notWritten(reason: string): string {
  return `Your answer was saved, but the next step could not be prepared. ${plainError(reason)}`;
}

/** A session being planned in the background: the screen says so, and opens the session when it is ready. */
function Planning({ goalTitle }: { goalTitle: string | null }) {
  return (
    <Screen>
      <div className="flex flex-col gap-[14px]">
        {goalTitle && <div className="t-caption text-muted">{goalTitle}</div>}
        <h1 className="t-display">Planning your session</h1>
        <p className="t-lead m-0">Frontier is choosing what to learn next, from where you stand. You can leave this screen: the session opens here when it is ready.</p>
      </div>
      <div className="work-dots" role="status" aria-label="Planning">
        <i />
        <i />
        <i />
      </div>
    </Screen>
  );
}

/** A card made in a session is about the idea being taught, or else the one last worked on. */
function sessionIdeas(snap: SessionSnapshot): { id: string; name: string }[] {
  if (snap.current) return [{ id: snap.current.nodeId, name: snap.current.name }];
  const last = [...snap.history.nodes].reverse().find((n) => n.items.length > 0);
  if (last) return [{ id: last.nodeId, name: last.name }];
  const first = snap.plan.steps[0];
  return first ? [{ id: first.nodeId, name: first.name }] : [];
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
          <ResponseExtras response={reconstruct} />
          {(reconstruct.text.trim() || !reconstruct.attachments?.length) && <div className="answer-block learner-text whitespace-pre-wrap">{reconstruct.text.trim() || <span className="text-muted">Nothing came back</span>}</div>}
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
function Exchange({ id, item, thinking, onStop }: { id: string; item: HistoryItem; /** The label while the tutor works on this answer. */ thinking?: string; onStop?: () => void }) {
  const read = isReading(item.card.stage) && !item.response?.testMe;
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
          <ResponseExtras response={item.response} />
          {item.response.answer.trim() ? (
            <div className="learner-text whitespace-pre-wrap">{item.response.answer}</div>
          ) : item.response.attachments?.length ? null : (
            <div className="learner-text text-muted">{item.response.testMe ? 'I know this, test me' : 'No idea'}</div>
          )}
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
      {thinking && <Thinking label={thinking} onStop={onStop} />}
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

type Send = (response: LearnerResponse, draftKey?: string) => void;

function PhaseView({ snap, busy, refocus, onSend, onDone }: { snap: SessionSnapshot; busy: boolean; refocus: boolean; onSend: Send; onDone: () => void }) {
  switch (snap.phase) {
    case 'reconstruct':
      return (
        <RecallStep
          sessionId={snap.id}
          prompt={`Before anything new: last session covered ${snap.previousNodes.length} idea${snap.previousNodes.length === 1 ? '' : 's'}. From memory, list or sketch what you remember. Two or three minutes, no looking back.`}
          submitLabel="Compare with the map"
          busy={busy}
          refocus={refocus}
          onSend={onSend}
        />
      );
    case 'orient':
      return (
        <section className="flex flex-col gap-[28px]">
          <div className="flex flex-col gap-[14px]">
            {snap.free && <div className="t-caption text-muted">{snap.free.counted ? `You chose this · it counts toward ${snap.goalTitle}` : 'You chose this · free study'}</div>}
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
      return <TeachStep snap={snap} busy={busy} refocus={refocus} onSend={onSend} />;
    case 'practice':
      return snap.practice ? (
        <section className="flex flex-col gap-[28px]">
          <div className="flex flex-col gap-[14px]">
            <h2 className="t-heading m-0">Before we close: practice</h2>
            <p className="m-0 text-soft">A few ideas from earlier sessions are starting to fade. These problems use them together; they never say which.</p>
          </div>
          <PracticeFlow view={snap.practice} revealedId={snap.practiceRevealed} busy={busy} onSubmit={(_id, answer, confidence) => onSend({ answer, confidence: confidence ?? undefined })} onNext={() => onSend({ answer: '' })} />
        </section>
      ) : null;
    case 'close':
      return <RecallStep sessionId={snap.id} prompt="Every idea from today, from memory, as a list or a map. Then one line on what you can now do." submitLabel="Finish recall" busy={busy} refocus={refocus} onSend={onSend} />;
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

function TeachStep({ snap, busy, refocus, onSend }: { snap: SessionSnapshot; busy: boolean; refocus: boolean; onSend: Send }) {
  const card = snap.card;
  const current = snap.current;
  const [effort, setEffort] = useState<number | null>(null);
  const draftKey = `session:${snap.id}:${current?.nodeId}:${current?.stage}:${historyLength(snap)}`;
  const drafts = useDrafts<CardDraft>([draftKey], EMPTY_CARD_DRAFT);
  const draft = drafts.values[draftKey] ?? EMPTY_CARD_DRAFT;
  const extras = useAnswerExtras();
  const [lastKey, setLastKey] = useState(draftKey);
  if (draftKey !== lastKey) {
    setLastKey(draftKey);
    setEffort(null);
  }
  if (snap.owed)
    return (
      <div className="button-row">
        <Button kind="primary" onClick={() => onSend({ answer: '' })} disabled={busy}>
          {busy ? 'Preparing the next step…' : 'Try again'}
        </Button>
      </div>
    );
  if (!card || !current) return <p className="t-small m-0 text-muted">Preparing the next step…</p>;

  const set = (patch: Partial<CardDraft>) => drafts.set(draftKey, { ...draft, ...patch });
  const send = (answer: string) => {
    if (busy) return;
    onSend(withExtras({ answer, confidence: draft.confidence ?? undefined, handle: draft.handle.trim() || undefined }, extras), draftKey);
  };

  const testMe = current.canTestOut ? () => onSend({ answer: '', testMe: true }) : undefined;
  const notes = (current.simplified || current.note) && (
    <div className="flex flex-col gap-[6px]">
      {current.simplified && <p className="session-note m-0">Simplified to the core idea. {current.simplified}.</p>}
      {current.note && <p className="session-note m-0">{current.note}</p>}
    </div>
  );

  if (isReading(card.stage)) {
    return (
      <section className="flex flex-col gap-[32px]">
        {notes}
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
          {testMe && (
            <Button kind="quiet" onClick={testMe} disabled={busy}>
              I know this, test me
            </Button>
          )}
        </div>
      </section>
    );
  }

  const asksConfidence = card.stage !== 'compress' && card.stage !== 'connect';
  return (
    <section className="flex flex-col gap-[32px]">
      {notes}
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
          autoFocus={refocus}
          extras
        />
        {card.stage === 'compress' && (
          <input className="input" aria-label="Handle" placeholder="A handle, if you like: a short phrase, image or mnemonic" value={draft.handle} onChange={(e) => set({ handle: e.target.value })} />
        )}
      </div>
      <AnswerActions onSubmit={() => send(draft.answer)} onNoIdea={() => send('')} onTestMe={testMe} disabled={busy} />
    </section>
  );
}

function RecallStep({ sessionId, prompt, submitLabel, busy, refocus, onSend }: { sessionId: string; prompt: string; submitLabel: string; busy: boolean; refocus: boolean; onSend: Send }) {
  const key = `session:${sessionId}:recall:${submitLabel}`;
  const drafts = useDrafts<CardDraft>([key], EMPTY_CARD_DRAFT);
  const text = (drafts.values[key] ?? EMPTY_CARD_DRAFT).answer;
  const extras = useAnswerExtras();
  const submit = () => {
    if (busy) return;
    onSend(withExtras({ answer: text }, extras), key);
  };
  return (
    <section className="flex flex-col gap-[32px]">
      <p className="t-question">{prompt}</p>
      <AnswerSurface value={text} onChange={(answer) => drafts.set(key, { ...EMPTY_CARD_DRAFT, answer })} onSubmit={submit} placeholder="From memory, however it comes." rows={6} disabled={busy} autoFocus={refocus} extras />
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
        items={[...snap.plan.steps.map((s) => ({
          key: s.nodeId,
          state: (s.status === 'done' ? 'done' : s.status === 'active' ? 'current' : 'upcoming') as 'current' | 'done' | 'upcoming',
          children: (
            <div className="flex flex-col gap-[2px]">
              <Markdown text={s.name} inline className={s.status === 'pending' ? 'text-secondary' : ''} />
              <span className="t-small text-muted">
                {aimLabel(s.aim)} · about {s.minutes} min{s.simplified ? ' · simplified' : ''}
              </span>
            </div>
          ),
        })),
        ...(snap.practice
          ? [
              {
                key: 'practice',
                state: (snap.phase === 'practice' ? 'current' : snap.practice.currentIndex === null ? 'done' : 'upcoming') as 'current' | 'done' | 'upcoming',
                children: (
                  <div className="flex flex-col gap-[2px]">
                    <span>Practice</span>
                    <span className="t-small text-muted">
                      {snap.practice.problems.length} {snap.practice.problems.length === 1 ? 'problem' : 'problems'} on fading ideas
                    </span>
                  </div>
                ),
              },
            ]
          : [])]}
      />
    </>
  );
}
