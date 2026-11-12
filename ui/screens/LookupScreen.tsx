import { useEffect, useRef, useState } from 'react';
import type { LookupAnswer, NodeCard } from '../../backend/api/contract';
import { call } from '../api';
import { plainError } from '../lib/errors';
import { Screen } from '../components/Shell';
import { Notice } from '../components/controls';
import { Markdown } from '../components/Markdown';
import { NodeCardView } from '../components/NodeCard';

const STATE_WORD = { owned: 'Yours', fringe: 'Learnable now', beyond: 'Beyond your edge' } as const;
/** Where a passage is: its source and page. */
const where = (p: { title: string; locator: string }) => (p.locator ? `${p.title}, ${p.locator}` : p.title);

/** Look things up in your own map: by meaning or name, answered from your own cards. */
/** `initialQuery`: a question asked from the command palette, looked up at once. */
export function LookupScreen({ onOpenTrail, onGoDeeper, initialQuery }: { onOpenTrail: (sessionId: string) => void; onGoDeeper: (goalId: string, nodeIds?: string[]) => Promise<void>; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery ?? '');
  /** The questions of this lookup so far, each with what it found; a new search starts a new list. */
  const [turns, setTurns] = useState<(LookupAnswer & { query: string })[]>([]);
  const [followUp, setFollowUp] = useState('');
  const result = turns.at(-1) ?? null;
  const [card, setCard] = useState<NodeCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** A new question starts over; a follow-up carries the conversation so far. */
  const search = async (asked = query, follow = false) => {
    const q = asked.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      const history = follow ? turns.filter((t) => t.answer).map((t) => ({ question: t.query, answer: t.answer?.text ?? '' })) : [];
      const r = await call('lookup.search', { query: q, history });
      setTurns(follow ? [...turns, { ...r, query: q }] : [{ ...r, query: q }]);
      if (follow) setFollowUp('');
      if (r.hits[0] && !r.answer) void open(r.hits[0].nodeId);
    } catch (e) {
      setError(plainError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };
  /** The idea asked for last: an answer for an earlier click must not replace it. */
  const wanted = useRef<string | null>(null);
  const open = async (nodeId: string) => {
    wanted.current = nodeId;
    try {
      const opened = await call('lookup.open', { nodeId });
      if (wanted.current === nodeId) setCard(opened);
    } catch (e) {
      if (wanted.current === nodeId) setError(plainError(e instanceof Error ? e.message : String(e)));
    }
  };
  useEffect(() => {
    if (initialQuery) void search(initialQuery);
    // once, for the question the screen was opened with
  }, []);

  const aside = card ? (
    <NodeCardView card={card} onSelect={(id) => void open(id)} onTrail={onOpenTrail} onGoDeeper={onGoDeeper} />
  ) : (
    <>
      <h2 className="t-title">Ask your map</h2>
      <p className="m-0 text-soft">Lookup searches only what you have added and learned: ideas by meaning and by name, including your own words and handles, and the text of your sources, with the page.</p>
      <div className="flex flex-col gap-[8px]">
        <div className="panel-label">Try</div>
        <p className="t-small m-0 text-secondary">What is the difference between two ideas?</p>
        <p className="t-small m-0 text-secondary">Why does a result hold?</p>
        <p className="t-small m-0 text-secondary">A half-remembered name, or the handle you gave an idea.</p>
      </div>
    </>
  );

  return (
    <Screen aside={aside} asideLabel={card ? 'Idea' : 'Ask your map'}>
      <div className="flex flex-col gap-[14px]">
        <h1 className="t-display">Lookup</h1>
        <p className="t-lead m-0">Ask in your own words. Answers come only from your own map and your own sources, and you can ask a follow-up.</p>
      </div>
      <form
        className="lookup-form"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input className="input lookup-input" aria-label="Ask or search" placeholder="What is the difference between…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        <button type="submit" className="btn btn-primary" disabled={busy || !query.trim()}>
          {busy ? 'Looking…' : 'Look up'}
        </button>
      </form>
      {error && <Notice error>{error}</Notice>}
      {result?.answerError && <Notice error detail={result.answerError}>The answer could not be written. What was found in your map and your sources is below.</Notice>}

      {turns.some((t) => t.answer) && (
        <section className="flex flex-col gap-[28px]" aria-label="Answers">
          {turns.map((t, i) =>
            t.answer ? (
              <div key={i} className="flex flex-col gap-[12px]">
                {i > 0 && <div className="t-small text-secondary lookup-followup-question">{t.query}</div>}
                <div className="t-caption text-muted">{t.answer.passages.length ? 'From your map and your sources' : 'From your map'}</div>
                <Markdown text={t.answer.text} className="t-lead" />
                {t.answer.cited.length > 0 && (
                  <div className="idea-links">
                    <span className="t-small text-muted">Rests on</span>
                    {t.answer.cited.map((id) => {
                      const hit = t.hits.find((h) => h.nodeId === id);
                      return hit ? (
                        <button key={id} type="button" className="link-button idea-link t-small" onClick={() => void open(id)}>
                          <Markdown text={hit.name} inline />
                        </button>
                      ) : null;
                    })}
                  </div>
                )}
                {t.answer.passages.length > 0 && (
                  <div className="idea-links">
                    <span className="t-small text-muted">Quotes</span>
                    {t.answer.passages.map((id) => {
                      const p = t.passages.find((x) => x.id === id);
                      return p ? (
                        <span key={id} className="t-small text-secondary">
                          {where(p)}
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
              </div>
            ) : null,
          )}
          <form
            className="lookup-form"
            onSubmit={(e) => {
              e.preventDefault();
              void search(followUp, true);
            }}
          >
            <input className="input lookup-input" aria-label="Ask a follow-up" placeholder="Ask a follow-up" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
            <button type="submit" className="btn btn-secondary" disabled={busy || !followUp.trim()}>
              {busy ? 'Looking…' : 'Ask'}
            </button>
          </form>
        </section>
      )}

      {result && result.passages.length > 0 && (
        <section className="flex flex-col gap-[14px]">
          <div className="section-head">
            <h2 className="t-heading m-0">In your sources</h2>
            <span className="t-small text-muted">{result.passages.length} {result.passages.length === 1 ? 'passage' : 'passages'}</span>
          </div>
          <ul className="list-card">
            {result.passages.map((p) => (
              <li key={p.id} className="flex flex-col gap-[4px]">
                <span className="t-caption text-muted">{where(p)}</span>
                <Markdown text={p.snippet} className="t-small text-soft lookup-snippet" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {result && (
        <section className="flex flex-col gap-[14px]">
          <div className="section-head">
            <h2 className="t-heading m-0">{result.hits.length ? 'Ideas' : 'Nothing found'}</h2>
            {result.hits.length > 0 && <span className="t-small text-muted">{result.hits.length} found</span>}
          </div>
          {result.hits.length === 0 ? (
            <p className="m-0 text-secondary">{result.passages.length ? `No idea on your map matches “${result.query}”, but your sources mention it.` : `Nothing in your map or your sources matches “${result.query}”. Add material that covers it in Library.`}</p>
          ) : (
            <ul className="list-card">
              {result.hits.map((h) => (
                <li key={h.nodeId} aria-current={card?.id === h.nodeId ? 'true' : undefined} className={card?.id === h.nodeId ? 'is-selected' : undefined}>
                  <button type="button" className="link-row flex flex-col gap-[4px]" onClick={() => void open(h.nodeId)}>
                    <span className="row">
                      <Markdown text={h.name} inline className="font-medium" />
                      <span className="t-caption shrink-0 text-muted">
                        {STATE_WORD[h.state]} · by {h.match}
                      </span>
                    </span>
                    <Markdown text={h.ownStatement ?? h.statement} className={`t-small ${h.ownStatement ? 'text-soft' : 'text-secondary'} lookup-snippet`} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </Screen>
  );
}
