import { useEffect, useState } from 'react';
import { GalleryVerticalEnd } from 'lucide-react';
import { call, onEvent } from '../api';
import type { CardSummary } from '../../backend/api/contract';
import { plural } from '../lib/cards';
import { Button } from './controls';
import './Cards.css';

function useCardSummary(goalId: string | null): CardSummary | null {
  const [summary, setSummary] = useState<CardSummary | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void call('cards.summary', { goalId }).then((s) => live && setSummary(s));
    load();
    const off = onEvent('cards.changed', load);
    return () => {
      live = false;
      off();
    };
  }, [goalId]);
  return summary;
}

/** A goal's flashcards in one quiet line: "23 flashcards · 5 to review", with Review. Nothing when it has none. */
export function GoalCardsLine({ goalId, onReview }: { goalId: string; onReview: () => void }) {
  const summary = useCardSummary(goalId);
  if (!summary || summary.total === 0) return null;
  return (
    <div className="cards-line">
      <GalleryVerticalEnd size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>
        <strong>{plural(summary.total, 'flashcard')}</strong>
        {summary.toReview > 0 ? ` · ${summary.toReview} to review` : ' · none due'}
      </span>
      {summary.toReview > 0 && <Button onClick={onReview}>Review</Button>}
    </div>
  );
}

/**
 * Today's flashcards: "N cards to review". A quiet line under the day's main action, or the main
 * action itself when nothing else is due.
 */
export function TodayCards({ main, onReview }: { main: boolean; onReview: () => void }) {
  const summary = useCardSummary(null);
  if (!summary || summary.toReview === 0) return null;
  const text = `${plural(summary.toReview, 'card')} to review`;
  if (main) {
    return (
      <div className="next-card">
        <div className="mode">
          <span className="mode-dot" aria-hidden="true" />
          Flashcards
        </div>
        <div className="flex flex-col gap-[6px]">
          <span className="t-heading">{text}</span>
          <p className="t-lead m-0">The facts you are keeping by heart. A few minutes keeps them.</p>
        </div>
        <div className="button-row">
          <Button kind="primary" onClick={onReview}>
            Review cards
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="cards-line">
      <GalleryVerticalEnd size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>
        <strong>{text}</strong>
      </span>
      <Button onClick={onReview}>Review</Button>
    </div>
  );
}
