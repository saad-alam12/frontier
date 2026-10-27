import { useCallback, useEffect, useState } from 'react';
import { call, onEvent } from '../api';
import type { DeltaClass, DeltaSummary, SourceSummary } from '../../backend/api/contract';
import { Breadcrumb, Screen } from '../components/Shell';
import { Button, Empty, Meter, Notice, Section } from '../components/controls';
import { Markdown } from '../components/Markdown';

const CLASS_LABEL: Record<DeltaClass, string> = {
  'new-fringe': 'New and learnable now',
  'new-beyond': 'New, needs a prerequisite first',
  deeper: 'Known, this source goes deeper',
  known: 'Already known',
  conflict: 'Conflicts with what you know',
};

const STATUS_LABEL: Record<SourceSummary['status'], string> = {
  pending: 'Waiting',
  running: 'Reading',
  done: 'Read',
  failed: 'Some parts failed',
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
    setSelected((current) => current ?? list[0]?.id ?? null);
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
    setSelected(null);
    await refresh();
  };

  const current = sources.find((s) => s.id === selected) ?? null;
  const addButton = (
    <Button kind="primary" onClick={() => void addFiles()} disabled={busy}>
      {busy ? 'Adding…' : 'Add files'}
    </Button>
  );

  if (sources.length === 0) {
    return (
      <Screen>
        <h1 className="t-display">Library</h1>
        {notice && <Notice error>{notice}</Notice>}
        <Empty action={addButton}>Add a lecture PDF, notes or a web page. Each is read into ideas and the reasoning between them, then compared with what you know.</Empty>
      </Screen>
    );
  }

  const aside = (
    <>
      <div className="section-head">
        <h2 className="t-title">Sources</h2>
        {addButton}
      </div>
      {notice && <Notice error>{notice}</Notice>}
      <ul className="list-card">
        {sources.map((s) => (
          <li key={s.id}>
            <button type="button" className="row" onClick={() => setSelected(s.id)} aria-current={s.id === selected ? 'true' : undefined}>
              <span className="flex min-w-0 flex-col">
                <span className={'truncate ' + (s.id === selected ? 'font-medium text-text' : 'text-soft')}>{s.title}</span>
                <span className="t-small text-muted">
                  {s.nodeCount} ideas · {STATUS_LABEL[s.status]}
                </span>
              </span>
              <Meter value={s.chunkCount ? s.chunksDone / s.chunkCount : 0} accent={s.status === 'running'} />
            </button>
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <Screen aside={aside} asideLabel="Sources">
      <Breadcrumb items={[{ label: 'Library', onClick: () => setSelected(null) }, ...(current ? [{ label: current.title }] : [])]} />
      {current ? (
        <>
          <div className="flex flex-col gap-[14px]">
            <h1 className="t-display">{current.title}</h1>
            {delta && delta.total > 0 && <p className="t-lead m-0">{delta.sentence}</p>}
            {current.error && <Notice error>{current.error}</Notice>}
            <div className="button-row">
              {current.status !== 'running' && current.chunksDone < current.chunkCount && <Button onClick={() => void call('library.run', { sourceId: current.id })}>Run again</Button>}
              <Button kind="quiet" onClick={() => void remove(current.id)}>
                Remove from library
              </Button>
            </div>
          </div>
          {delta &&
            (Object.keys(CLASS_LABEL) as DeltaClass[])
              .filter((cls) => delta.counts[cls] > 0)
              .map((cls) => (
                <Section key={cls} title={CLASS_LABEL[cls]} meta={`${delta.counts[cls]}`}>
                  <ul className="list-card">
                    {delta.items
                      .filter((i) => i.cls === cls)
                      .map((i) => (
                        <li key={i.nodeId} className="flex flex-col gap-[4px]">
                          <span className="font-medium">{i.name}</span>
                          <Markdown text={i.statement} className="text-soft" />
                        </li>
                      ))}
                  </ul>
                </Section>
              ))}
          <Section title="Parts" meta={`${current.chunksDone} of ${current.chunkCount} read`}>
            <ul className="list-card">
              {current.chunks.map((c) => (
                <li key={c.idx} className="row">
                  <span className="truncate text-soft">{c.locator || `Part ${c.idx + 1}`}</span>
                  <span className="t-small shrink-0 text-muted">
                    {c.status === 'done' ? `${c.nodeCount} ideas` : STATUS_LABEL[c.status]}
                    {c.error && <span className="block text-danger">{c.error}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        </>
      ) : (
        <Empty>Choose a source to see what it adds for you.</Empty>
      )}
    </Screen>
  );
}
