import { useCallback, useEffect, useMemo, useState } from 'react';
import { call } from '../api';
import type { EraseRequest, ErasePreview, EraseScope } from '../../backend/api/contract';
import { plain } from '../lib/mapGraph';
import { Button, ChoiceChips, Notice, Section } from './controls';
import { ConfirmDialog } from './Dialog';
import './EraseMap.css';

const SCOPES: { value: EraseScope; label: string }[] = [
  { value: 'everything', label: 'Everything' },
  { value: 'topics', label: 'Topics' },
  { value: 'sources', label: 'Sources' },
  { value: 'ideas', label: 'Ideas' },
];

/** Singular nouns per scope, for the search field, the dialog title and empty lists. */
const NOUN: Record<Exclude<EraseScope, 'everything'>, string> = { topics: 'topic', sources: 'source', ideas: 'idea' };

interface Item {
  id: string;
  name: string;
  meta: string | null;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The "Erase from your map" section of Settings: pick everything, or topics, sources or ideas from a
 * searchable list, see what it would erase, and confirm. Erasing everything asks for the word typed,
 * because it cannot be undone and takes the most.
 */
export function EraseMap() {
  const [scope, setScope] = useState<EraseScope | null>(null);
  const [lists, setLists] = useState<Record<Exclude<EraseScope, 'everything'>, Item[]> | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<ErasePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [map, sources] = await Promise.all([call('map.view'), call('library.list')]);
    setLists({
      topics: map.topics.map((t) => ({ id: t.id, name: plain(t.name), meta: count(t.size, 'idea') })),
      sources: [...sources].sort((a, b) => a.title.localeCompare(b.title)).map((s) => ({ id: s.id, name: s.title, meta: count(s.nodeCount, 'idea') })),
      ideas: map.nodes.map((n) => ({ id: n.id, name: plain(n.name), meta: null })).sort((a, b) => a.name.localeCompare(b.name)),
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = scope && scope !== 'everything' && lists ? lists[scope] : [];
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
  }, [items, query]);

  const request: EraseRequest | null = scope === 'everything' ? { scope } : scope && chosen.size > 0 ? { scope, ids: [...chosen] } : null;

  const choose = (next: EraseScope) => {
    setScope(next);
    setChosen(new Set());
    setQuery('');
    setError(null);
  };

  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  };

  const askToErase = async () => {
    if (!request) return;
    setError(null);
    setStatus(null);
    try {
      setPreview(await call('map.erasePreview', request));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const erase = async () => {
    if (!request) return;
    setBusy(true);
    try {
      const result = await call('map.erase', request);
      const parts = [count(result.ideas, 'idea'), count(result.links, 'link'), ...(result.sources ? [count(result.sources, 'source')] : [])];
      const remap = result.goalsToMap.length ? ` ${count(result.goalsToMap.length, 'goal')} will be mapped again.` : '';
      setStatus(`Erased ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.${remap}`);
      setChosen(new Set());
      setPreview(null);
      await load();
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const title =
    scope === 'everything' ? 'Erase your whole map?' : scope ? `Erase ${count(chosen.size, NOUN[scope])}?` : '';

  return (
    <Section title="Erase from your map" gap={14}>
      <p className="m-0 text-[13px] text-muted">
        Remove ideas you no longer want, with their links and what you learned about them. This cannot be undone. Your settings are never touched.
      </p>
      <ChoiceChips label="What to erase" options={SCOPES} value={scope} onChange={choose} />

      {scope === 'everything' && (
        <p className="m-0 text-[13px] text-secondary">
          Every idea, link and source goes, with what you learned. Your goals stay and are mapped again from scratch.
        </p>
      )}

      {scope && scope !== 'everything' && (
        <div className="flex flex-col gap-[10px]">
          <input
            className="input"
            type="search"
            aria-label={`Search ${scope}`}
            placeholder={`Search ${scope}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {!lists ? null : items.length === 0 ? (
            <p className="m-0 text-[13px] text-muted">Your map has no {scope} yet.</p>
          ) : shown.length === 0 ? (
            <p className="m-0 text-[13px] text-muted">No {NOUN[scope]} matches.</p>
          ) : (
            <ul className="list-card erase-list" aria-label={`Choose ${scope} to erase`}>
              {shown.map((item) => (
                <li key={item.id}>
                  <label className="erase-item">
                    <input type="checkbox" checked={chosen.has(item.id)} onChange={() => toggle(item.id)} />
                    <span className="erase-name">{item.name}</span>
                    {item.meta && <span className="t-small text-muted">{item.meta}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="m-0 t-small text-muted">{count(chosen.size, NOUN[scope])} chosen</p>
        </div>
      )}

      <div className="button-row">
        <Button kind="danger" onClick={() => void askToErase()} disabled={!request || busy}>
          Erase…
        </Button>
        {status && <Notice>{status}</Notice>}
        {error && <Notice error>{error}</Notice>}
      </div>

      <ConfirmDialog
        open={preview !== null}
        title={title}
        confirmLabel="Erase"
        destructive
        typeToConfirm={scope === 'everything' ? 'erase' : undefined}
        busy={busy}
        onConfirm={() => void erase()}
        onCancel={() => setPreview(null)}
      >
        {preview && (
          <>
            <p className="m-0">
              This erases {count(preview.ideas, 'idea')}
              {preview.links > 0 ? ` and ${count(preview.links, 'link')} between them` : ''}.{' '}
              {preview.learned > 0 ? `What you learned about ${preview.learned === preview.ideas ? (preview.ideas === 1 ? 'it' : 'them') : `${preview.learned} of them`} goes too.` : 'You have not studied any of them yet.'}
              {preview.sources > 0 && ` It also removes ${count(preview.sources, 'source')} from your Library, with the copies of their files.`}
            </p>
            <p className="m-0 mt-[10px]">This cannot be undone.</p>
          </>
        )}
      </ConfirmDialog>
    </Section>
  );
}
