import { useCallback, useEffect, useState } from 'react';
import { call, onEvent } from '../api';
import type { DeltaClass, DeltaSummary, SourceSummary } from '../../backend/api/contract';
import { Button, Empty, Page } from '../components/Page';

const CLASS_LABEL: Record<DeltaClass, string> = {
  'new-fringe': 'New and learnable now',
  'new-beyond': 'New, needs a prerequisite first',
  deeper: 'Known, this source goes deeper',
  known: 'Already known',
  conflict: 'Conflicts with what you know',
};

const CLASS_STYLE: Record<DeltaClass, string> = {
  'new-fringe': 'bg-green-50 text-green-800',
  'new-beyond': 'bg-amber-50 text-amber-800',
  deeper: 'bg-blue-50 text-blue-800',
  known: 'bg-stone-100 text-stone-600',
  conflict: 'bg-red-50 text-red-800',
};

export function LibraryScreen() {
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [delta, setDelta] = useState<DeltaSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const list = await call('library.list');
    setSources(list);
  }, []);

  useEffect(() => {
    void refresh();
    return onEvent('library.progress', (p) => {
      void refresh();
      if (p.message) setNotice(p.message);
    });
  }, [refresh]);

  useEffect(() => {
    if (!selected) {
      setDelta(null);
      return;
    }
    const source = sources.find((s) => s.id === selected);
    if (!source) return;
    void call('library.delta', { sourceId: selected }).then(setDelta);
  }, [selected, sources]);

  const addFiles = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await call('library.addFiles');
      if (result.skipped.length) setNotice(result.skipped.join('\n'));
      await refresh();
      if (result.added[0]) setSelected(result.added[0].id);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await call('library.remove', { sourceId: id });
    if (selected === id) setSelected(null);
    await refresh();
  };

  const current = sources.find((s) => s.id === selected) ?? null;

  return (
    <Page
      title="Library"
      subtitle="Add lecture PDFs, notes or web pages. Each one is read into ideas and reasoning chains, then compared with what you already know."
      actions={
        <Button kind="primary" onClick={() => void addFiles()} disabled={busy}>
          {busy ? 'Adding…' : 'Add files'}
        </Button>
      }
    >
      {notice && <pre className="mb-4 whitespace-pre-wrap rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{notice}</pre>}
      {sources.length === 0 ? (
        <Empty>No sources yet. Add a PDF, Markdown, text or HTML file to begin.</Empty>
      ) : (
        <div className="grid grid-cols-[minmax(260px,1fr)_2fr] gap-6">
          <ul className="space-y-2">
            {sources.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelected(s.id)}
                  className={'w-full rounded-lg border p-3 text-left ' + (selected === s.id ? 'border-stone-900 bg-white' : 'border-stone-200 bg-white hover:border-stone-400')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{s.title}</span>
                    <StatusPill status={s.status} />
                  </div>
                  <div className="mt-1 text-xs text-stone-500">
                    {s.kind} · {s.chunkCount} chunk{s.chunkCount === 1 ? '' : 's'} · {s.nodeCount} ideas
                  </div>
                  <Progress done={s.chunksDone} total={s.chunkCount} />
                </button>
              </li>
            ))}
          </ul>
          <div>
            {current ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-medium">{current.title}</h2>
                  <div className="flex gap-2">
                    {current.status !== 'running' && current.chunksDone < current.chunkCount && (
                      <Button onClick={() => void call('library.run', { sourceId: current.id })}>Run again</Button>
                    )}
                    <Button kind="danger" onClick={() => void remove(current.id)}>
                      Remove
                    </Button>
                  </div>
                </div>
                {current.error && <p className="text-sm text-red-700">{current.error}</p>}
                {delta && delta.total > 0 && (
                  <div className="rounded-lg border border-stone-200 bg-white p-4">
                    <p className="text-sm">{delta.sentence}</p>
                    <div className="mt-3 space-y-3">
                      {(Object.keys(CLASS_LABEL) as DeltaClass[])
                        .filter((cls) => delta.counts[cls] > 0)
                        .map((cls) => (
                          <div key={cls}>
                            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-stone-500">
                              {CLASS_LABEL[cls]} · {delta.counts[cls]}
                            </div>
                            <ul className="space-y-1">
                              {delta.items
                                .filter((i) => i.cls === cls)
                                .map((i) => (
                                  <li key={i.nodeId} className="flex items-start gap-2 text-sm">
                                    <span className={'mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ' + CLASS_STYLE[cls]}>{i.kind}</span>
                                    <span>
                                      <span className="font-medium">{i.name}</span>
                                      <span className="text-stone-600"> — {i.statement}</span>
                                    </span>
                                  </li>
                                ))}
                            </ul>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
                <div className="rounded-lg border border-stone-200 bg-white p-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">Chunks</div>
                  <ul className="divide-y divide-stone-100 text-sm">
                    {current.chunks.map((c) => (
                      <li key={c.idx} className="flex items-center justify-between gap-3 py-1.5">
                        <span className="truncate text-stone-700">
                          {c.idx + 1}. {c.locator}
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-stone-500">
                          {c.nodeCount > 0 && <span>{c.nodeCount} ideas</span>}
                          <StatusPill status={c.status} />
                        </span>
                        {c.error && <span className="w-full text-xs text-red-700">{c.error}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <Empty>Select a source to see what it adds for you.</Empty>
            )}
          </div>
        </div>
      )}
    </Page>
  );
}

function StatusPill({ status }: { status: string }) {
  const style =
    status === 'done'
      ? 'bg-green-50 text-green-700'
      : status === 'running'
        ? 'bg-blue-50 text-blue-700'
        : status === 'failed'
          ? 'bg-red-50 text-red-700'
          : 'bg-stone-100 text-stone-600';
  return <span className={'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ' + style}>{status}</span>;
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-stone-100">
      <div className="h-full bg-stone-700" style={{ width: `${pct}%` }} />
    </div>
  );
}
