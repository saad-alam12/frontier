import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { call } from '../api';
import type { CardView, IdeaRef } from '../../backend/api/contract';
import { CARD_BACK_MAX, CARD_FRONT_MAX } from '../../backend/core/cards';
import { Dialog } from './Dialog';
import { Button, Notice } from './controls';
import { Markdown } from './Markdown';
import { keepLineBreaks } from '../lib/cards';
import './Cards.css';

/** How the sheet opens: drafting from selected text, asking what the card should ask, by hand, or editing a card. */
export type CardSheetStart = { mode: 'selection'; selection: { text: string; message: string } } | { mode: 'request' } | { mode: 'hand' } | { mode: 'edit'; card: CardView };

export interface CardSheetProps {
  start: CardSheetStart;
  /** The ideas a new card is tagged with at first (the session's current idea, the map's idea). */
  ideas: IdeaRef[];
  /** The goal a new card is made in; absent lets the app choose (the one goal that holds its idea). */
  goalId?: string | null;
  sessionId?: string | null;
  onClose: () => void;
  onSaved?: (card: CardView) => void;
}

type Phase = 'ask' | 'drafting' | 'edit';

/**
 * The one flashcard sheet, used everywhere a card is made or edited. The card writer drafts from a
 * selection (deciding whether it is the question or the answer) or from a request; the learner edits
 * the front and back, which show as they will in review, checks the ideas it is tagged with, and saves.
 * ⌘↵ saves, Esc cancels.
 */
export function CardSheet({ start, ideas: initialIdeas, goalId, sessionId, onClose, onSaved }: CardSheetProps) {
  const editing = start.mode === 'edit' ? start.card : null;
  const [phase, setPhase] = useState<Phase>(start.mode === 'request' ? 'ask' : start.mode === 'selection' ? 'drafting' : 'edit');
  const [request, setRequest] = useState('');
  const [front, setFront] = useState(editing?.front ?? '');
  const [back, setBack] = useState(editing?.back ?? '');
  const [ideas, setIdeas] = useState<IdeaRef[]>(editing?.ideas ?? initialIdeas);
  const [drafted, setDrafted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const live = useRef(true);
  const requestId = useId();

  const draft = async (input: { selection?: { text: string; message: string }; request?: string; partial?: { front: string; back: string } }) => {
    setPhase('drafting');
    setError(null);
    try {
      const card = await call('cards.draft', { ideaIds: ideas.map((i) => i.id), goalId: goalId ?? null, ...input });
      if (!live.current) return;
      setFront(card.front);
      setBack(card.back);
      setDrafted(true);
    } catch (e) {
      if (live.current) setError(`The card could not be drafted: ${e instanceof Error ? e.message : String(e)}. You can write it yourself.`);
    } finally {
      if (live.current) setPhase('edit');
    }
  };

  // A selection is drafted once, as the sheet opens (the ref keeps a development double mount from
  // asking twice); closing before the draft arrives drops it.
  const asked = useRef(false);
  useEffect(() => {
    live.current = true;
    if (start.mode === 'selection' && !asked.current) {
      asked.current = true;
      void draft({ selection: start.selection });
    }
    return () => {
      live.current = false;
    };
  }, []);

  const ready = phase === 'edit' && front.trim().length > 0 && back.trim().length > 0 && ideas.length > 0 && !saving;
  const save = async () => {
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      const nodeIds = ideas.map((i) => i.id);
      const origin = start.mode === 'selection' ? 'selection' : start.mode === 'request' || drafted ? 'request' : 'hand';
      const card = await call(
        'cards.save',
        editing ? { id: editing.id, front, back, nodeIds } : { front, back, nodeIds, origin, sessionId: sessionId ?? null, ...(goalId !== undefined ? { goalId } : {}) },
      );
      onSaved?.(card);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };
  const askDraft = () => request.trim() && void draft({ request: request.trim() });

  const actions =
    phase === 'ask' ? (
      <>
        <button type="button" className="link-button is-start" onClick={() => setPhase('edit')}>
          Write it myself
        </button>
        <Button kind="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button kind="primary" onClick={askDraft} disabled={!request.trim()}>
          Draft the card
        </Button>
      </>
    ) : (
      <>
        {start.mode === 'hand' && (
          <button type="button" className="link-button is-start" disabled={phase === 'drafting' || ideas.length === 0} onClick={() => void draft({ partial: { front, back } })}>
            Draft it for me
          </button>
        )}
        <Button kind="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button kind="primary" onClick={() => void save()} disabled={!ready}>
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Save card'}
        </Button>
      </>
    );

  return (
    <Dialog open onClose={onClose} title={editing ? 'Edit flashcard' : 'New flashcard'} actions={actions} width={600}>
      <div
        className="card-sheet"
        // while a selection is being drafted there is nothing to type yet: focus rests on the sheet, not on a remove button
        tabIndex={-1}
        data-autofocus={start.mode === 'selection' ? '' : undefined}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
          e.preventDefault();
          if (phase === 'ask') askDraft();
          else void save();
        }}
      >
        {phase === 'ask' ? (
          <div className="field">
            <label className="field-label" htmlFor={requestId}>
              What should the card ask?
            </label>
            <input
              id={requestId}
              className="input"
              autoFocus
              value={request}
              maxLength={1000}
              placeholder="For example: the softmax formula"
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  askDraft();
                }
              }}
            />
            <div className="field-hint">A formula, a definition, a name or a number to know by heart. You can change the card before saving it.</div>
          </div>
        ) : (
          <>
            {start.mode === 'selection' && <p className="sheet-lead t-small">{phase === 'drafting' ? 'Drafting a card from your selection…' : 'Drafted from your selection. Change anything before you save.'}</p>}
            <CardFace label="Front" kind="front" value={front} onChange={setFront} placeholder="The question" loading={phase === 'drafting'} max={CARD_FRONT_MAX} autoFocus={start.mode === 'hand'} />
            <CardFace label="Back" kind="back" value={back} onChange={setBack} placeholder="The answer" loading={phase === 'drafting'} max={CARD_BACK_MAX} />
            <div className="card-face">
              <div className="card-face-label">{ideas.length === 1 ? 'Idea' : 'Ideas'}</div>
              <IdeaTags ideas={ideas} onChange={setIdeas} />
            </div>
          </>
        )}
        {error && <Notice error>{error}</Notice>}
      </div>
    </Dialog>
  );
}

/**
 * One side of the card. It shows as it will in review (Markdown and math); a click or Tab turns it into
 * plain text to edit, with the math previewed under it.
 */
function CardFace({
  label,
  kind,
  value,
  onChange,
  placeholder,
  loading,
  max,
  autoFocus,
}: {
  label: string;
  kind: 'front' | 'back';
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  loading: boolean;
  max: number;
  autoFocus?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const id = useId();
  const box = `card-face-box is-${kind}`;
  return (
    <div className="card-face">
      <label className="card-face-label" htmlFor={id}>
        <span>{label}</span>
        {editing && value.length > max * 0.8 && (
          <span>
            {value.length} / {max}
          </span>
        )}
      </label>
      {loading ? (
        <div className={`${box} is-loading`} aria-busy="true" aria-label={`${label}: drafting`}>
          <span className="shimmer-line" style={{ width: kind === 'front' ? '72%' : '88%' }} />
          {kind === 'back' && <span className="shimmer-line" style={{ width: '54%' }} />}
        </div>
      ) : editing || !value.trim() ? (
        <>
          <textarea
            id={id}
            className={box}
            value={value}
            maxLength={max}
            rows={kind === 'front' ? 1 : 2}
            placeholder={placeholder}
            autoFocus={editing || autoFocus}
            onFocus={(e) => {
              setEditing(true);
              const end = e.currentTarget.value.length;
              e.currentTarget.setSelectionRange(end, end);
            }}
            onBlur={() => setEditing(false)}
            onChange={(e) => onChange(e.target.value)}
          />
          {value.includes('$') && (
            <div className="card-face-preview" aria-label={`${label} preview`}>
              <Markdown text={keepLineBreaks(value)} />
            </div>
          )}
        </>
      ) : (
        <button type="button" id={id} className={box} onClick={() => setEditing(true)} onFocus={() => setEditing(true)} title="Edit">
          <Markdown text={keepLineBreaks(value)} />
        </button>
      )}
    </div>
  );
}

/** The ideas a card is tagged with, and a search to add one. */
function IdeaTags({ ideas, onChange }: { ideas: IdeaRef[]; onChange: (ideas: IdeaRef[]) => void }) {
  const [adding, setAdding] = useState(ideas.length === 0);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<IdeaRef[] | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setFound(null);
      return;
    }
    let current = true;
    const t = window.setTimeout(() => {
      void call('cards.findIdeas', { query: q }).then((r) => {
        if (!current) return;
        setFound(r.filter((x) => !ideas.some((i) => i.id === x.id)));
        setActive(0);
      });
    }, 120);
    return () => {
      current = false;
      window.clearTimeout(t);
    };
  }, [query, ideas]);

  const pick = (idea: IdeaRef) => {
    onChange([...ideas, idea]);
    setQuery('');
    setFound(null);
    setAdding(false);
  };
  return (
    <div className="idea-tags">
      {ideas.map((idea) => (
        <span key={idea.id} className="idea-tag">
          <span>
            <Markdown text={idea.name} inline />
          </span>
          <button type="button" aria-label={`Remove ${idea.name}`} onClick={() => onChange(ideas.filter((i) => i.id !== idea.id))}>
            <X size={12} strokeWidth={2} aria-hidden="true" />
          </button>
        </span>
      ))}
      {adding ? (
        <div className="idea-search">
          <input
            className="input"
            aria-label="Find an idea to add"
            placeholder="Find an idea"
            autoFocus={ideas.length > 0}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => window.setTimeout(() => !query.trim() && ideas.length > 0 && setAdding(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                // close the search, not the sheet
                e.preventDefault();
                e.stopPropagation();
                setQuery('');
                if (ideas.length > 0) setAdding(false);
              }
              if (!found?.length) return;
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length);
              }
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                const idea = found[active];
                if (idea) pick(idea);
              }
            }}
          />
          {found && (
            <ul className="idea-suggest" role="listbox" aria-label="Ideas">
              {found.length === 0 ? (
                <li className="empty">No idea by that name</li>
              ) : (
                found.map((idea, i) => (
                  <li key={idea.id} role="option" aria-selected={i === active}>
                    <button type="button" className={i === active ? 'is-active' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(idea)}>
                      <Markdown text={idea.name} inline />
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      ) : (
        <button type="button" className="link-button" onClick={() => setAdding(true)}>
          Add an idea
        </button>
      )}
    </div>
  );
}
