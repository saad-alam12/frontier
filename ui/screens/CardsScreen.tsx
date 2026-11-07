import { useCallback, useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { call, onEvent } from '../api';
import type { CardListView, CardOrigin, CardQueueView, CardRating, CardView } from '../../backend/api/contract';
import { CARD_RATINGS, RATING_LABEL, formatInterval } from '../../backend/core/cards';
import { Screen } from '../components/Shell';
import { Button, Empty, Notice } from '../components/controls';
import { ConfirmDialog } from '../components/Dialog';
import { Markdown } from '../components/Markdown';
import { CardSheet } from '../components/CardSheet';
import type { CardSheetProps } from '../components/CardSheet';
import { useSurface } from '../lib/activity';
import { keepLineBreaks, plural, whenText } from '../lib/cards';
import { plain } from '../lib/mapGraph';
import '../components/Cards.css';

export type CardsTab = 'review' | 'all';
export interface CardsView {
  tab: CardsTab;
  goalId: string | null;
}

const ORIGIN_LABEL: Record<CardOrigin, string> = { auto: 'Made after a session', selection: 'From a selection', request: 'Asked for', hand: 'Written by you' };

type Sheet = Pick<CardSheetProps, 'start' | 'ideas' | 'goalId'>;

/**
 * Cards: flashcards for the facts to know by heart. Review shows the due cards one at a time (Space
 * shows the answer, 1–4 rate it); All cards lists every card to search, edit, suspend or delete.
 */
export function CardsScreen({ initial, onShowOnMap }: { initial?: Partial<CardsView>; onShowOnMap: (nodeId: string) => void }) {
  const [tab, setTab] = useState<CardsTab>(initial?.tab ?? 'review');
  const [goalId, setGoalId] = useState<string | null>(initial?.goalId ?? null);
  const [goals, setGoals] = useState<{ id: string; title: string }[]>([]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  /** Bumped after a card is saved, so the open view reloads. */
  const [version, setVersion] = useState(0);

  useEffect(() => {
    void call('cards.list', {}).then((l) => setGoals(l.goals));
  }, [version]);

  const write = () => setSheet({ start: { mode: 'hand' }, ideas: [], goalId: goalId ?? undefined });
  const edit = (card: CardView) => setSheet({ start: { mode: 'edit', card }, ideas: card.ideas });

  return (
    <Screen>
      <div className="flex flex-col gap-[14px]">
        <h1 className="t-display">Cards</h1>
        <p className="t-lead m-0">Flashcards for the facts worth knowing by heart. A few minutes a day keeps them.</p>
      </div>
      <div className="flex flex-col gap-[22px]">
        <div className="cards-toolbar">
          <div role="radiogroup" aria-label="View" className="segmented is-small">
            {(['review', 'all'] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={tab === t} onClick={() => setTab(t)}>
                {t === 'review' ? 'Review' : 'All cards'}
              </button>
            ))}
          </div>
          {goals.length > 0 && (
            <select className="select-quiet" aria-label="Goal" value={goalId ?? ''} onChange={(e) => setGoalId(e.target.value || null)}>
              <option value="">All goals</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          )}
          <span className="push">
            <Button onClick={write}>Write a card</Button>
          </span>
        </div>
        {tab === 'review' ? (
          <Review key={`${goalId}:${version}`} goalId={goalId} onWrite={write} onBrowse={() => setTab('all')} onEdit={edit} />
        ) : (
          <AllCards key={`${goalId}:${version}`} goalId={goalId} onEdit={edit} onShowOnMap={onShowOnMap} />
        )}
      </div>
      {sheet && <CardSheet {...sheet} onClose={() => setSheet(null)} onSaved={() => setVersion((v) => v + 1)} />}
    </Screen>
  );
}

/** Keys typed into a field or a sheet are not review keys. */
function ignoreKey(e: KeyboardEvent): boolean {
  const t = e.target;
  if (!(t instanceof Element)) return false;
  return e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, dialog') !== null;
}

/** One card at a time: the front, then the answer, then how well it was known. */
function Review({ goalId, onWrite, onBrowse, onEdit }: { goalId: string | null; onWrite: () => void; onBrowse: () => void; onEdit: (card: CardView) => void }) {
  const [queue, setQueue] = useState<CardQueueView | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setQueue(await call('cards.queue', { goalId }));
    setShown(false);
  }, [goalId]);
  useEffect(() => {
    void load();
  }, [load]);
  // cards written in the background appear once the queue has run out
  useEffect(() => (queue && !queue.card ? onEvent('cards.changed', () => void load()) : undefined), [queue, load]);

  const card = queue?.card ?? null;
  useSurface(card ? 'cards' : null, { goalId: card?.goalId ?? null });

  const rate = useCallback(
    async (rating: CardRating) => {
      if (!card || busy) return;
      setBusy(true);
      setError(null);
      try {
        setQueue(await call('cards.review', { cardId: card.id, rating, goalId }));
        setShown(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [card, busy, goalId],
  );

  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (ignoreKey(e)) return;
      if (e.key === ' ' && !shown) {
        e.preventDefault();
        setShown(true);
        return;
      }
      const rating = Number(e.key);
      if (shown && (CARD_RATINGS as readonly number[]).includes(rating)) {
        e.preventDefault();
        void rate(rating as CardRating);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, shown, rate]);

  if (!queue) return null;
  if (queue.total === 0) {
    return (
      <Empty action={<Button onClick={onWrite}>Write a card</Button>}>
        {goalId
          ? 'This goal has no flashcards yet. They are written as you learn its ideas.'
          : 'Cards for formulas, definitions, names and numbers appear here as you learn. You can also write one, or make one from text you select in a session.'}
      </Empty>
    );
  }
  if (!card) return <Finished queue={queue} onBrowse={onBrowse} onWrite={onWrite} />;

  const now = Date.now();
  return (
    <div className="review">
      <div className="t-small text-muted" aria-live="polite">
        {[queue.left.due ? `${queue.left.due} to review` : null, queue.left.new ? `${queue.left.new} new` : null].filter(Boolean).join(' · ')}
      </div>
      <article className="review-card" key={card.id} aria-label="Flashcard">
        <div className="review-meta">
          <span className="ideas">
            {card.ideas.map((idea, i) => (
              <span key={idea.id}>
                {i > 0 && ' · '}
                <Markdown text={idea.name} inline />
              </span>
            ))}
          </span>
          {card.goalTitle && <span className="shrink-0">{card.goalTitle}</span>}
        </div>
        <Markdown text={keepLineBreaks(card.front)} className="t-question" />
        {shown && (
          <div className="review-back">
            <Markdown text={keepLineBreaks(card.back)} />
          </div>
        )}
      </article>
      <div className="review-actions">
        {shown ? (
          <div className="rating-row" role="group" aria-label="How well did you know it?">
            {CARD_RATINGS.map((r) => (
              <button key={r} type="button" className="rating-button" disabled={busy} onClick={() => void rate(r)}>
                <span className="label">
                  {RATING_LABEL[r]}
                  <kbd className="key">{r}</kbd>
                </span>
                <span className="when">{formatInterval(new Date(card.next[r]).getTime() - now)}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <Button kind="primary" onClick={() => setShown(true)}>
              Show answer
            </Button>
            <kbd className="key">Space</kbd>
          </>
        )}
      </div>
      {error && <Notice error>{error}</Notice>}
      <div className="review-foot">
        <span>{shown ? 'How well did you know it? Each button says when the card comes back.' : 'Answer it in your head first, then look.'}</span>
        <button type="button" className="link-button" onClick={() => onEdit(card)}>
          Edit card
        </button>
      </div>
    </div>
  );
}

/** The queue is empty: what was done, and when the next card comes. */
function Finished({ queue, onBrowse, onWrite }: { queue: CardQueueView; onBrowse: () => void; onWrite: () => void }) {
  const next = queue.nextDue ? new Date(queue.nextDue).getTime() - Date.now() : null;
  const lines = [
    queue.reviewedToday ? `You reviewed ${plural(queue.reviewedToday, 'card')} today.` : null,
    next !== null ? `The next one comes back in ${formatInterval(next)}.` : null,
    queue.newWaiting ? `${plural(queue.newWaiting, 'new card')} wait${queue.newWaiting === 1 ? 's' : ''} for tomorrow.` : null,
  ].filter(Boolean);
  return (
    <div className="review-done" role="status">
      <span className="done-mark" aria-hidden="true">
        <Check size={20} strokeWidth={2} />
      </span>
      <div className="flex flex-col gap-[6px]">
        <h2 className="t-heading">{queue.reviewedToday ? 'Done for now' : 'Nothing to review right now'}</h2>
        {lines.length > 0 && <p className="text-secondary">{lines.join(' ')}</p>}
      </div>
      <div className="button-row">
        <Button onClick={onBrowse}>See all cards</Button>
        <Button kind="quiet" onClick={onWrite}>
          Write a card
        </Button>
      </div>
    </div>
  );
}

/** Every card: search, filter by idea, and edit, suspend, delete or find it on the map. */
function AllCards({ goalId, onEdit, onShowOnMap }: { goalId: string | null; onEdit: (card: CardView) => void; onShowOnMap: (nodeId: string) => void }) {
  const [query, setQuery] = useState('');
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [list, setList] = useState<CardListView | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CardView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setList(await call('cards.list', { goalId, nodeId, query })), [goalId, nodeId, query]);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), query ? 120 : 0);
    return () => window.clearTimeout(t);
  }, [load, query]);
  useEffect(() => onEvent('cards.changed', () => void load()), [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!list) return null;
  const filtered = Boolean(query.trim() || nodeId);
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="card-filters">
        <input className="input" aria-label="Find a card" placeholder="Find a card" value={query} onChange={(e) => setQuery(e.target.value)} />
        {list.ideas.length > 1 && (
          <select className="select-quiet" aria-label="Idea" value={nodeId ?? ''} onChange={(e) => setNodeId(e.target.value || null)}>
            <option value="">Every idea</option>
            {list.ideas.map((i) => (
              <option key={i.id} value={i.id}>
                {plain(i.name)} ({i.count})
              </option>
            ))}
          </select>
        )}
      </div>
      {error && <Notice error>{error}</Notice>}
      {list.cards.length === 0 ? (
        <p className="m-0 text-secondary">{filtered ? 'No card matches.' : goalId ? 'This goal has no flashcards yet.' : 'No flashcards yet.'}</p>
      ) : (
        <>
          <div className="t-small text-muted">{plural(list.cards.length, 'card')}</div>
          <ul className="list-card card-list">
            {list.cards.map((c) => {
              const when = whenText(c);
              const isOpen = open === c.id;
              return (
                <li key={c.id}>
                  <button type="button" className="card-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.id)}>
                    <Markdown text={keepLineBreaks(c.front)} className="front" />
                    <span className={when.due ? 'status is-due' : 'status'}>{when.text}</span>
                    <span className="meta">{[c.ideas.map((i) => plain(i.name)).join(', '), c.goalTitle, ORIGIN_LABEL[c.origin]].filter(Boolean).join(' · ')}</span>
                  </button>
                  {isOpen && (
                    <div className="card-row-body">
                      <div className="back">
                        <Markdown text={keepLineBreaks(c.back)} />
                      </div>
                      <div className="card-row-actions">
                        <button type="button" className="link-button" onClick={() => onEdit(c)}>
                          Edit
                        </button>
                        <button type="button" className="link-button" onClick={() => void act(() => call('cards.suspend', { cardId: c.id, suspended: !c.suspended }))}>
                          {c.suspended ? 'Resume reviews' : 'Suspend'}
                        </button>
                        {c.ideas[0] && (
                          <button type="button" className="link-button" onClick={() => onShowOnMap(c.ideas[0]?.id ?? '')}>
                            Show on map
                          </button>
                        )}
                        <button type="button" className="link-button" onClick={() => setRemoving(c)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <ConfirmDialog
        open={removing !== null}
        title="Delete this card?"
        confirmLabel="Delete card"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const card = removing;
          setRemoving(null);
          if (card) void act(() => call('cards.delete', { cardId: card.id }));
        }}
      >
        <p>Its reviews go with it. To stop seeing it without losing it, suspend it instead.</p>
      </ConfirmDialog>
    </div>
  );
}
