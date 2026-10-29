import { useState } from 'react';
import type { LookupAnswer, NodeCard } from '../../backend/api/contract';
import { call } from '../api';
import { Screen } from '../components/Shell';
import { Notice } from '../components/controls';
import { Markdown } from '../components/Markdown';
import { NodeCardView } from '../components/NodeCard';

const STATE_WORD = { owned: 'Yours', fringe: 'Learnable now', beyond: 'Beyond your edge' } as const;

/** Look things up in your own map: by meaning or name, answered from your own cards. */
export function LookupScreen({ onOpenTrail, onGoDeeper }: { onOpenTrail: (sessionId: string) => void; onGoDeeper: (goalId: string, nodeIds?: string[]) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<(LookupAnswer & { query: string }) | null>(null);
  const [card, setCard] = useState<NodeCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call('lookup.search', { query: q });
      setResult({ ...r, query: q });
      if (r.hits[0] && !r.answer) void open(r.hits[0].nodeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const open = async (nodeId: string) => setCard(await call('lookup.open', { nodeId }));

  const aside = card ? (
    <NodeCardView card={card} onSelect={(id) => void open(id)} onTrail={onOpenTrail} onGoDeeper={onGoDeeper} />
  ) : (
    <>
      <h2 className="t-title">Ask your map</h2>
      <p className="m-0 text-soft">Lookup searches only what you have added and learned, by meaning and by name, including your own words and handles.</p>
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
        <p className="t-lead m-0">Ask in your own words. Answers come only from your own map.</p>
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

      {result && result.answer && (
        <section className="flex flex-col gap-[12px]">
          <div className="t-caption text-muted">From your map</div>
          <Markdown text={result.answer.text} className="t-lead" />
          {result.answer.cited.length > 0 && (
            <div className="idea-links">
              <span className="t-small text-muted">Rests on</span>
              {result.answer.cited.map((id) => {
                const hit = result.hits.find((h) => h.nodeId === id);
                return hit ? (
                  <button key={id} type="button" className="link-button idea-link t-small" onClick={() => void open(id)}>
                    <Markdown text={hit.name} inline />
                  </button>
                ) : null;
              })}
            </div>
          )}
        </section>
      )}

      {result && (
        <section className="flex flex-col gap-[14px]">
          <div className="section-head">
            <h2 className="t-heading m-0">{result.hits.length ? 'Ideas' : 'Nothing found'}</h2>
            {result.hits.length > 0 && <span className="t-small text-muted">{result.hits.length} found</span>}
          </div>
          {result.hits.length === 0 ? (
            <p className="m-0 text-secondary">Nothing in your map matches “{result.query}”. Add material that covers it in Library.</p>
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
