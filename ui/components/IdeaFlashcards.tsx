import { useCallback, useEffect, useState } from 'react';
import { call, onEvent } from '../api';
import type { CardView, IdeaRef } from '../../backend/api/contract';
import { keepLineBreaks, whenText } from '../lib/cards';
import { CardSheet } from './CardSheet';
import { Markdown } from './Markdown';
import './Cards.css';

/** An idea's flashcards on its card in the Map: the fronts (a click shows the back), when each is due, and Add a card. */
export function IdeaFlashcards({ idea }: { idea: IdeaRef }) {
  const [cards, setCards] = useState<CardView[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => setCards((await call('cards.list', { nodeId: idea.id })).cards), [idea.id]);
  useEffect(() => {
    void refresh();
    return onEvent('cards.changed', () => void refresh());
  }, [refresh]);

  if (!cards) return null;
  return (
    <section className="idea-cards" aria-label="Flashcards">
      <div className="section-head">
        <div className="panel-label">Flashcards</div>
        <button type="button" className="link-button" onClick={() => setAdding(true)}>
          Add a card
        </button>
      </div>
      {cards.length === 0 ? (
        <p className="t-small m-0 text-muted">None yet. Cards hold this idea&rsquo;s facts to know by heart.</p>
      ) : (
        <ul>
          {cards.map((c) => (
            <li key={c.id}>
              <button type="button" className="idea-card-row" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>
                <Markdown text={c.front} inline />
                <span className="when">{whenText(c).text}</span>
              </button>
              {open === c.id && (
                <div className="idea-card-back">
                  <Markdown text={keepLineBreaks(c.back)} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && <CardSheet start={{ mode: 'hand' }} ideas={[idea]} onClose={() => setAdding(false)} onSaved={() => void refresh()} />}
    </section>
  );
}
