import { useEffect, useId, useState } from 'react';
import type { GoalDetail, WatchedFolderView } from '../../backend/api/contract';
import { call, onEvent } from '../api';
import { plainError } from '../lib/errors';
import { Button } from './controls';

/**
 * Watched folders (design §7): a course folder whose new files are added on their own, to a goal as its
 * material or to the Library. Lists each with its file count and files that could not be read.
 */
export function WatchedFolders({ onChanged }: { onChanged: () => void }) {
  const [folders, setFolders] = useState<WatchedFolderView[] | null>(null);
  const [goals, setGoals] = useState<GoalDetail[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [goalId, setGoalId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const selectId = useId();

  useEffect(() => {
    const load = () => void call('library.watchedFolders').then(setFolders);
    load();
    void call('goals.list').then((g) => setGoals(g.filter((d) => d.goal.status !== 'draft')));
    return onEvent('library.progress', load);
  }, []);
  if (!folders) return null;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage({ text: plainError(e instanceof Error ? e.message : String(e)), error: true });
    } finally {
      setBusy(false);
    }
  };
  const watchOne = () =>
    act(async () => {
      const result = await call('library.watchFolder', { goalId: goalId || null });
      if (!result) return;
      setFolders(result.folders);
      setChoosing(false);
      setMessage({ text: result.added === 0 ? 'Watching it. No new files in it yet.' : `Watching it. ${result.added} ${result.added === 1 ? 'file was' : 'files were'} added.`, error: false });
      onChanged();
    });

  return (
    <section className="watched-folders" aria-label="Watched folders">
      <div className="flex items-baseline justify-between gap-[12px]">
        <h2 className="panel-label m-0">Watched folders</h2>
        {folders.length > 0 && (
          <button type="button" className="link-button t-small" disabled={busy} onClick={() => void act(async () => setFolders((await call('library.scanFolders')).folders))}>
            Look now
          </button>
        )}
      </div>
      {folders.length === 0 && !choosing && <p className="t-small m-0 text-muted">Watch your course folder and new lectures arrive on their own.</p>}
      {folders.map((f) => (
        <div key={f.path} className="watched-folder">
          <div className="flex min-w-0 flex-col gap-[2px]">
            <span className="truncate text-soft" title={f.path}>
              {f.name}
            </span>
            <span className="t-small text-muted">
              {!f.present ? 'Not found: it was moved, renamed, or is on a drive that is not connected' : `${f.files} ${f.files === 1 ? 'file' : 'files'} · ${f.goalTitle ? `for ${f.goalTitle}` : 'to the Library'}`}
            </span>
            {f.problems.map((p) => (
              <span key={p.name} className="t-small text-danger">
                {p.error}
              </span>
            ))}
          </div>
          <button type="button" className="link-button t-small shrink-0" disabled={busy} onClick={() => void act(async () => setFolders(await call('library.unwatchFolder', { path: f.path })))}>
            Stop
          </button>
        </div>
      ))}
      {choosing ? (
        <div className="flex flex-col gap-[10px]">
          <label className="flex flex-col gap-[6px]" htmlFor={selectId}>
            <span className="t-small text-secondary">New files go to</span>
            <select id={selectId} className="input" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">The Library, read at once</option>
              {goals.map((g) => (
                <option key={g.goal.id} value={g.goal.id}>
                  {g.goal.title ?? g.goal.text}, as its material
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <Button kind="primary" onClick={() => void watchOne()} disabled={busy}>
              {busy ? 'Adding…' : 'Choose the folder'}
            </Button>
            <Button kind="quiet" onClick={() => setChoosing(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button onClick={() => setChoosing(true)} disabled={busy}>
            Watch a folder
          </Button>
        </div>
      )}
      {message && <p className={`t-small m-0 ${message.error ? 'text-danger' : 'text-secondary'}`}>{message.text}</p>}
    </section>
  );
}
