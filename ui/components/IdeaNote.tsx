import { useEffect, useState } from 'react';
import { call } from '../api';
import { plainError } from '../lib/errors';
import { submitOnModEnter } from './AnswerSurface';
import { Button } from './controls';

/**
 * The learner's free note on an idea (design §10, "Notes"): anything they want to keep with it, in their
 * words. Shown as written; Edit opens it, Save keeps it, and an empty note is removed.
 */
export function IdeaNote({ nodeId, note: initial, onSaved }: { nodeId: string; note: string | null; onSaved?: (note: string | null) => void }) {
  const [note, setNote] = useState(initial);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setNote(initial), [initial]);

  const save = async () => {
    if (draft === null) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await call('notes.saveIdea', { nodeId, text: draft.trim() });
      setNote(saved.note);
      setDraft(null);
      onSaved?.(saved.note);
    } catch (e) {
      setError(plainError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  if (draft !== null) {
    return (
      <div className="idea-note is-editing no-print">
        <textarea
          aria-label="Your note"
          className="answer-input learner-text"
          rows={4}
          value={draft}
          placeholder="Anything you want to keep with this idea: a reminder, where it tripped you, a link to another idea."
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            submitOnModEnter(e, () => void save());
            if (e.key === 'Escape') setDraft(null);
          }}
        />
        {error && <p className="t-small m-0 text-danger">{error}</p>}
        <div className="button-row">
          <Button kind="primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save note'}
          </Button>
          <Button kind="quiet" onClick={() => setDraft(null)} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  if (!note) {
    return (
      <button type="button" className="link-button self-start no-print" onClick={() => setDraft('')}>
        Add a note
      </button>
    );
  }
  return (
    <div className="idea-note">
      <div className="flex items-baseline gap-[12px]">
        <span className="t-caption text-muted">Your note</span>
        <button type="button" className="link-button no-print" onClick={() => setDraft(note)}>
          Edit
        </button>
      </div>
      <p className="m-0 learner-text whitespace-pre-wrap">{note}</p>
    </div>
  );
}
