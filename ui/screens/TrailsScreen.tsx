import { Asides } from '../components/AskTutor';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Trail, TrailItem, TrailSummary } from '../../backend/api/contract';
import { confidenceLabel } from '../../backend/core/types';
import { joinNames } from '../../backend/core/freeSession';
import { call } from '../api';
import { Breadcrumb, Screen } from '../components/Shell';
import { Button, ChoiceChips, Empty, MetaLine } from '../components/controls';
import { Markdown } from '../components/Markdown';
import { ResponseExtras } from '../components/AnswerExtras';
import { STAGE_LABEL, cardText } from '../lib/stages';

const PLAY_MS = 1400;

/** Every past session as a timeline you can replay step by step (design §8). */
export function TrailsScreen({ initialId }: { initialId: string | null }) {
  const [trails, setTrails] = useState<TrailSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initialId);
  const [trail, setTrail] = useState<Trail | null>(null);
  const [goal, setGoal] = useState('all');
  /** How many items are shown; null shows the whole trail. */
  const [cursor, setCursor] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void call('trails.list', {}).then((list) => {
      setTrails(list);
      setSelected((s) => s ?? list[0]?.id ?? null);
    });
  }, []);
  useEffect(() => {
    if (!selected) return;
    setCursor(null);
    setPlaying(false);
    void call('trails.get', { sessionId: selected }).then(setTrail);
  }, [selected]);

  const total = trail?.items.length ?? 0;
  const step = useCallback((delta: number) => setCursor((c) => Math.max(1, Math.min(total, (c ?? total) + delta))), [total]);
  useEffect(() => {
    if (!playing) return;
    if (cursor !== null && cursor >= total) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => step(1), PLAY_MS);
    return () => clearTimeout(t);
  }, [playing, cursor, total, step]);
  useEffect(() => {
    if (cursor !== null) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [cursor]);

  if (!trails) return <Screen>{null}</Screen>;
  if (trails.length === 0) {
    return (
      <Screen>
        <div className="flex flex-col gap-[10px]">
          <h1 className="t-display">Trails</h1>
          <p className="t-lead m-0">Every session you have done, step by step.</p>
        </div>
        <Empty>Your first session will appear here. Open it later to read it again or replay it.</Empty>
      </Screen>
    );
  }

  const goals = [...new Map(trails.filter((t) => t.goalId).map((t) => [t.goalId as string, t.goalTitle])).entries()];
  const shown = trails.filter((t) => goal === 'all' || t.goalId === goal);
  const aside = (
    <>
      <h2 className="t-title">Sessions</h2>
      {goals.length > 1 && <ChoiceChips small label="Goal" value={goal} onChange={setGoal} options={[{ value: 'all', label: 'All' }, ...goals.map(([id, title]) => ({ value: id, label: title }))]} />}
      <ul className="list-card">
        {shown.map((t) => (
          <li key={t.id} className={t.id === selected ? 'is-selected' : undefined}>
            <button type="button" className="link-row flex flex-col gap-[2px]" onClick={() => setSelected(t.id)} aria-current={t.id === selected ? 'true' : undefined}>
              <span className="row">
                <span>{t.title}</span>
                <span className="t-caption shrink-0 text-muted">{formatDay(t.startedAt)}</span>
              </span>
              {t.asked && <span className="t-small line-clamp-2 text-secondary">{t.asked.description ? `“${t.asked.description}”` : `You picked ${joinNames(t.asked.picked).replace(/\$/g, '')}`}</span>}
              <span className="t-small text-muted">
                {[t.ideas.length ? `${t.ideas.length} ${t.ideas.length === 1 ? 'idea' : 'ideas'}` : null, `${t.answers} ${t.answers === 1 ? 'answer' : 'answers'}`, t.status === 'abandoned' ? 'ended early' : t.status === 'active' ? 'in progress' : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );

  const items = trail ? trail.items.slice(0, cursor ?? total) : [];
  return (
    <Screen aside={aside} asideLabel="Sessions">
      {trail && (
        <>
          <div className="flex flex-col gap-[26px]">
            <Breadcrumb items={[{ label: 'Trails' }, { label: trail.summary.goalTitle || (trail.summary.asked ? 'Free study' : 'Session') }, { label: formatDay(trail.summary.startedAt) }]} />
            <div className="flex flex-col gap-[14px]">
              <h1 className="t-display">{trail.summary.title}</h1>
              <MetaLine
                small
                items={[`Started at ${formatTime(trail.summary.startedAt)}`, duration(trail.summary.startedAt, trail.summary.endedAt), trail.summary.status === 'abandoned' ? 'Ended early' : trail.summary.status === 'active' ? 'In progress' : 'Finished', trail.summary.ideas.length ? `${trail.summary.ideas.length} ideas` : null]}
              />
            </div>
            <div className="replay-bar">
              {cursor === null ? (
                <Button
                  onClick={() => {
                    setCursor(1);
                    setPlaying(true);
                  }}
                  disabled={total === 0}
                >
                  Replay
                </Button>
              ) : (
                <>
                  <Button onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : cursor >= total ? 'Replay again' : 'Play'}</Button>
                  <Button kind="quiet" onClick={() => step(-1)} disabled={cursor <= 1}>
                    Back
                  </Button>
                  <Button kind="quiet" onClick={() => step(1)} disabled={cursor >= total}>
                    Next
                  </Button>
                  <span className="t-small text-muted">
                    Step {cursor} of {total}
                  </span>
                  <Button
                    kind="quiet"
                    onClick={() => {
                      setCursor(null);
                      setPlaying(false);
                    }}
                  >
                    Show all
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-[40px]">
            {items.map((item, i) => (
              <TrailEntry key={item.id} item={item} fresh={cursor !== null && i === items.length - 1} />
            ))}
            <div ref={endRef} />
          </div>
        </>
      )}
    </Screen>
  );
}

function TrailEntry({ item, fresh }: { item: TrailItem; fresh: boolean }) {
  const cls = `trail-entry${fresh ? ' is-fresh' : ''}`;
  switch (item.type) {
    case 'plan':
      return (
        <article className={cls}>
          <div className="t-caption text-muted">Plan · {formatTime(item.at)}</div>
          {item.asked?.description && (
            <div className="flex flex-col gap-[8px]">
              <div className="t-caption text-muted">You asked</div>
              <Answer text={item.asked.description} />
            </div>
          )}
          {item.asked && !item.asked.description && <p className="t-small m-0 text-secondary">You picked these ideas to learn.</p>}
          {item.resumed && <p className="t-small m-0 text-secondary">Picked up {item.resumed} where you stopped last time.</p>}
          <p className="m-0 text-soft">{item.orientation}</p>
          <MetaLine small items={item.ideas.map((n, i) => <Markdown key={i} text={n} inline />)} />
        </article>
      );
    case 'recall':
      return (
        <article className={cls}>
          <div className="t-caption text-muted">Recall from last time</div>
          <Answer text={item.text} />
          {item.recalled.length > 0 && <p className="t-small m-0 text-secondary">{item.recalled.map((r) => `${r.name.replace(/\$/g, '')} ${Math.round(r.score * 10)}/10`).join(' · ')}</p>}
        </article>
      );
    case 'step':
      return (
        <article className={cls}>
          <div className="t-caption text-muted">
            <Markdown text={item.idea} inline /> · {STAGE_LABEL[item.stage]}
            {item.carried ? ' · from the session before' : ''}
          </div>
          <Markdown text={cardText(item.card)} className="text-[15px] text-soft" />
          <Asides asides={item.asides} past />
          {item.response && item.card.stage !== 'explain' && item.card.stage !== 'support' && item.card.stage !== 'reteach' && <Answer text={item.response.answer} confidence={item.response.confidence} extras={item.response} />}
          {item.grade && (
            <div className="flex flex-col gap-[4px]">
              <span className="font-medium">{Math.round(item.grade.score * 10)}/10</span>
              <Markdown text={item.grade.feedback} className="text-soft" />
            </div>
          )}
        </article>
      );
    case 'idea-done':
      return (
        <div className={`${cls} trail-milestone`}>
          <span className="dot is-done" aria-hidden="true" />
          <span>
            Finished <Markdown text={item.idea} inline />
            {item.score !== null ? ` · ${Math.round(item.score * 10)}/10` : ''}
          </span>
        </div>
      );
    case 'practice':
      return (
        <article className={cls}>
          <div className="t-caption text-muted">Practice</div>
          <Markdown text={item.statement} className="text-[15px] text-soft" />
          <Answer text={item.answer} />
          <div className="solution-block flex flex-col gap-[6px]">
            <div className="t-caption text-muted">Solution</div>
            <Markdown text={item.solution} className="text-[15px] text-soft" />
          </div>
          {item.score !== null && (
            <div className="flex flex-col gap-[4px]">
              <span className="font-medium">{item.score}/10</span>
              {item.feedback && <Markdown text={item.feedback} className="text-soft" />}
            </div>
          )}
        </article>
      );
    case 'pause':
      return <div className={`${cls} trail-milestone text-muted`}>Paused · {formatTime(item.at)}</div>;
    case 'close':
      return (
        <article className={cls}>
          <div className="t-caption text-muted">Closing recall</div>
          <Answer text={item.text} />
          {item.canDo && <p className="t-lead m-0">{item.canDo}</p>}
          {item.preview && (
            <p className="t-small m-0 text-secondary">
              Next session opened with: <Markdown text={item.preview} inline />
            </p>
          )}
        </article>
      );
    case 'end':
      return (
        <div className={`${cls} trail-milestone`}>
          <span className={`dot ${item.status === 'done' ? 'is-done' : 'is-upcoming'}`} aria-hidden="true" />
          <span>{item.status === 'done' ? 'Session finished' : 'Ended early; the next session picked up from here'}</span>
        </div>
      );
  }
}

function Answer({ text, confidence, extras }: { text: string; confidence?: number; extras?: { attachments?: string[]; quote?: string } }) {
  return (
    <div className="answer-block flex flex-col gap-[6px]">
      {extras && <ResponseExtras response={extras} />}
      {text.trim() ? <div className="learner-text whitespace-pre-wrap">{text}</div> : extras?.attachments?.length ? null : <div className="learner-text text-muted">No idea</div>}
      {confidence !== undefined && <div className="t-caption text-muted">{confidenceLabel(confidence).replace(/^./, (c) => c.toUpperCase())}</div>}
    </div>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function duration(start: string, end: string | null): string | null {
  if (!end) return null;
  const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  return minutes < 1 ? 'under a minute' : `${minutes} min`;
}
