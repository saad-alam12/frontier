import { useEffect, useId, useState } from 'react';
import type { MergeCandidate, NodeCard } from '../../backend/api/contract';
import { call } from '../api';
import { plainError } from '../lib/errors';
import { Button } from './controls';
import { ConfirmDialog } from './Dialog';
import { Markdown } from './Markdown';

type Open = 'edit' | 'merge' | null;

/**
 * Editing the map by hand (design §8, "Editing the map"), on an idea's card: rename it or correct its
 * statement, merge a duplicate into it, or say "I know this: test me".
 */
export function EditIdea({ card, onChanged, onTestMe }: { card: NodeCard; onChanged: () => void; onTestMe?: (nodeId: string) => void }) {
  const [open, setOpen] = useState<Open>(null);
  return (
    <div className="edit-idea">
      <div className="edit-idea-actions">
        {onTestMe && (
          <button type="button" className="link-button" onClick={() => onTestMe(card.id)} title="A question that shows you know it, with nothing explained first">
            I know this: test me
          </button>
        )}
        <button type="button" className="link-button" aria-expanded={open === 'edit'} onClick={() => setOpen(open === 'edit' ? null : 'edit')}>
          Rename or correct
        </button>
        <button type="button" className="link-button" aria-expanded={open === 'merge'} onClick={() => setOpen(open === 'merge' ? null : 'merge')}>
          Merge a duplicate
        </button>
      </div>
      {open === 'edit' && (
        <EditForm
          card={card}
          onDone={(changed) => {
            setOpen(null);
            if (changed) onChanged();
          }}
        />
      )}
      {open === 'merge' && (
        <MergePanel
          card={card}
          onDone={(merged) => {
            setOpen(null);
            if (merged) onChanged();
          }}
        />
      )}
    </div>
  );
}

function EditForm({ card, onDone }: { card: NodeCard; onDone: (changed: boolean) => void }) {
  const [name, setName] = useState(card.name);
  const [statement, setStatement] = useState(card.statement);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), statement: useId() };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone((await call('map.editIdea', { nodeId: card.id, name, statement })).changed);
    } catch (e) {
      setError(plainError(e instanceof Error ? e.message : String(e)));
      setBusy(false);
    }
  };
  return (
    <div className="edit-idea-panel">
      <label className="flex flex-col gap-[6px]" htmlFor={ids.name}>
        <span className="t-caption text-muted">Name</span>
        <input id={ids.name} className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-[6px]" htmlFor={ids.statement}>
        <span className="t-caption text-muted">What it says</span>
        <textarea id={ids.statement} className="input" rows={4} value={statement} maxLength={1200} onChange={(e) => setStatement(e.target.value)} />
      </label>
      <p className="t-small m-0 text-muted">The old name stays as another name of the idea, so your material still finds it. Math is written in LaTeX between $ signs.</p>
      {error && <p className="t-small m-0 text-danger">{error}</p>}
      <div className="button-row">
        <Button kind="primary" onClick={() => void save()} disabled={busy || !name.trim() || !statement.trim()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button kind="quiet" onClick={() => onDone(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function MergePanel({ card, onDone }: { card: NodeCard; onDone: (merged: boolean) => void }) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<MergeCandidate[] | null>(null);
  const [chosen, setChosen] = useState<MergeCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchId = useId();
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      void call('map.mergeCandidates', { nodeId: card.id, query }).then((c) => live && setCandidates(c), (e: unknown) => live && setError(plainError(e instanceof Error ? e.message : String(e))));
    }, query ? 200 : 0);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [card.id, query]);

  const merge = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await call('map.mergeIdeas', { keepId: card.id, dropId: chosen.id });
      setChosen(null);
      onDone(true);
    } catch (e) {
      setError(plainError(e instanceof Error ? e.message : String(e)));
      setChosen(null);
      setBusy(false);
    }
  };

  return (
    <div className="edit-idea-panel">
      <p className="t-small m-0 text-secondary">Pick an idea that says the same thing. It joins this one: its name, links, what you showed about it and its flashcards all move here.</p>
      <input id={searchId} className="input" type="search" aria-label="Find the duplicate" placeholder="Find the duplicate by name" value={query} onChange={(e) => setQuery(e.target.value)} />
      {candidates && candidates.length === 0 && <p className="t-small m-0 text-muted">{query ? 'No idea matches that.' : 'No idea on your map is close to this one. Search by name.'}</p>}
      {candidates && candidates.length > 0 && (
        <ul className="merge-candidates">
          {candidates.map((c) => (
            <li key={c.id}>
              <button type="button" className="merge-candidate" onClick={() => setChosen(c)} disabled={busy}>
                <span className="font-medium">
                  <Markdown text={c.name} inline />
                </span>
                <span className="t-small text-secondary">
                  <Markdown text={c.statement} inline />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="t-small m-0 text-danger">{error}</p>}
      <div className="button-row">
        <Button kind="quiet" onClick={() => onDone(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
      <ConfirmDialog
        open={chosen !== null}
        title="Merge these ideas?"
        confirmLabel="Merge"
        busy={busy}
        onConfirm={() => void merge()}
        onCancel={() => setChosen(null)}
      >
        <p className="m-0">
          “{chosen?.name}” becomes another name of “{card.name}”. Its links, what you showed about it, its flashcards and notes move to “{card.name}”. This cannot be undone, but each day&rsquo;s backup in Settings keeps the map as it was.
        </p>
      </ConfirmDialog>
    </div>
  );
}
