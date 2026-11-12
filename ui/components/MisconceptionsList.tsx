import { useEffect, useState } from 'react';
import type { MisconceptionView } from '../../backend/api/contract';
import { call } from '../api';
import { plainError } from '../lib/errors';
import { Button, Notice } from './controls';
import { Markdown } from './Markdown';

export interface MisconceptionActions {
  /** A practice set on these ideas of a goal was written: open it. */
  onOpenPractice: (setId: string) => void;
  onTestMe: (nodeIds: string[]) => void;
  onShowOnMap: (nodeId: string) => void;
}

/** Two clean answers end it, one at least half a day after it was seen: with two too soon, the next one does. */
const cleanLine = (n: number) => (n === 0 ? 'no clean answer since' : n === 1 ? '1 of 2 clean answers since' : 'your next clean answer ends it');
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

/**
 * Misconceptions (design §5.2): every wrong belief an answer showed, open ones first, how close each is
 * to ending, and a contrast problem to clear it.
 */
export function MisconceptionsList({ actions }: { actions: MisconceptionActions }) {
  const [items, setItems] = useState<MisconceptionView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void call('stats.misconceptions').then(setItems);
  }, []);
  if (!items) return null;

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(plainError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  };
  const open = items.filter((m) => m.endedAt === null);
  const ended = items.filter((m) => m.endedAt !== null);
  if (items.length === 0) {
    return <p className="t-lead m-0 text-secondary">No misconception on record. When an answer shows a wrong belief, it is listed here until two clean answers show it is gone.</p>;
  }
  return (
    <div className="misconceptions">
      <p className="m-0 text-secondary">A misconception ends after two clean answers about its idea, one of them at least half a day later. Until then the tutor watches for it and practice brings a problem where it would lead you wrong.</p>
      {error && <Notice error>{error}</Notice>}
      <section className="flex flex-col gap-[12px]">
        <h2 className="panel-label m-0">Open ({open.length})</h2>
        {open.length === 0 && <p className="t-small m-0 text-muted">None open.</p>}
        {open.map((m) => (
          <article key={m.id} className="misconception">
            <div className="flex flex-wrap items-baseline justify-between gap-x-[12px] gap-y-[2px]">
              <button type="button" className="link-button" onClick={() => actions.onShowOnMap(m.nodeId)}>
                <Markdown text={m.idea} inline />
              </button>
              <span className="t-small text-muted">
                First seen {day(m.firstSeen)}
                {m.lastSeen !== m.firstSeen ? `, again ${day(m.lastSeen)}` : ''} · {cleanLine(m.cleanSince)}
              </span>
            </div>
            <Markdown text={m.description} className="text-soft" />
            <div className="button-row">
              {m.goalId ? (
                <Button
                  disabled={busy !== null}
                  onClick={() =>
                    void act(m.id, async () => {
                      const set = await call('practice.start', { goalId: m.goalId ?? '', kind: 'compound', nodeIds: [m.nodeId], level: 'normal' });
                      if (set) actions.onOpenPractice(set.id);
                      else throw new Error('No practice could be written for this idea yet.');
                    })
                  }
                >
                  {busy === m.id ? 'Writing a problem…' : 'Practise it'}
                </Button>
              ) : (
                <Button onClick={() => actions.onTestMe([m.nodeId])}>Test me on it</Button>
              )}
              <Button kind="quiet" disabled={busy !== null} title="The answer was read wrongly: this is not a belief of yours" onClick={() => void act(m.id, async () => setItems(await call('stats.dismissMisconception', { bugId: m.id })))}>
                Not mine
              </Button>
            </div>
          </article>
        ))}
      </section>
      {ended.length > 0 && (
        <section className="flex flex-col gap-[12px]">
          <h2 className="panel-label m-0">Ended ({ended.length})</h2>
          <ul className="misconceptions-ended">
            {ended.map((m) => (
              <li key={m.id}>
                <span className="flex flex-col gap-[2px]">
                  <Markdown text={m.idea} inline className="font-medium" />
                  <Markdown text={m.description} inline className="text-secondary" />
                </span>
                <span className="t-small text-muted shrink-0">Ended {day(m.endedAt ?? m.lastSeen)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
