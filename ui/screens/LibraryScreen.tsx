import { useCallback, useEffect, useState } from 'react';
import { call, onEvent } from '../api';
import type { DeltaClass, DeltaItem, DeltaSummary, IdeaRef, SourceSummary } from '../../backend/api/contract';
import { Breadcrumb, Screen } from '../components/Shell';
import { Button, ChoiceChips, Empty, Meter, Notice, Section } from '../components/controls';
import { Markdown } from '../components/Markdown';
import { Dialog } from '../components/Dialog';
import { plainError } from '../lib/errors';
import { ROLE_LABEL } from './goals/labels';

const CLASS_LABEL: Record<DeltaClass, string> = {
  'new-fringe': 'Learnable now',
  'new-beyond': 'Needs a prerequisite first',
  deeper: 'Yours, this goes deeper',
  known: 'Yours',
  conflict: 'Conflicts with what you know',
};

const CLASS_TONE: Record<DeltaClass, string> = {
  'new-fringe': 'text-accent-text',
  'new-beyond': 'text-muted',
  deeper: 'text-text',
  known: 'text-text',
  conflict: 'text-danger',
};

type Order = 'source' | 'alpha';

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
  const [order, setOrder] = useState<Order>('source');
  const [highlight, setHighlight] = useState<string | null>(null);
  const [reread, setReread] = useState<{ sourceId: string; text: string; error: boolean } | null>(null);
  const [pasting, setPasting] = useState(false);

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

  const readAgain = async (id: string) => {
    try {
      const { retired } = await call('library.reread', { sourceId: id });
      setReread({ sourceId: id, error: false, text: retired > 0 ? `Reading it again. ${retired} small ${retired === 1 ? 'idea nothing depended on was' : 'ideas nothing depended on were'} removed; ideas you have studied stay.` : 'Reading it again.' });
      await refresh();
    } catch (error) {
      setReread({ sourceId: id, error: true, text: error instanceof Error ? error.message : String(error) });
    }
  };

  const current = sources.find((s) => s.id === selected) ?? null;
  const addButton = (
    <div className="button-row">
      <Button onClick={() => setPasting(true)} disabled={busy}>
        Paste text
      </Button>
      <Button kind="primary" onClick={() => void addFiles()} disabled={busy}>
        {busy ? 'Adding…' : 'Add files'}
      </Button>
    </div>
  );
  const pasteSheet = pasting && (
    <PasteSheet
      onClose={() => setPasting(false)}
      onAdded={async (sourceId, existed) => {
        setPasting(false);
        setNotice(existed ? 'That text is already in the library.' : null);
        await refresh();
        setSelected(sourceId);
      }}
    />
  );

  if (sources.length === 0) {
    return (
      <Screen>
        <div className="flex flex-col gap-[10px]">
          <h1 className="t-display">Library</h1>
          <p className="t-lead m-0">The material your maps are built from.</p>
        </div>
        {notice && <Notice error>{notice}</Notice>}
        <Empty action={addButton}>Add a lecture PDF, notes or a web page, or paste text. Each is read into ideas and the reasoning between them, then compared with what you know.</Empty>
        {pasteSheet}
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
                <span className="t-small text-muted">{s.readsIdeas ? `${s.nodeCount} ideas · ${STATUS_LABEL[s.status]}` : `Kept as ${s.roles.map((r) => ROLE_LABEL[r].toLowerCase()).join(', ')}`}</span>
              </span>
              {s.readsIdeas && s.chunkCount > 0 && <Meter value={s.chunksDone / s.chunkCount} accent={s.status === 'running'} />}
            </button>
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <Screen aside={aside} asideLabel="Sources">
      {pasteSheet}
      <Breadcrumb items={[{ label: 'Library', onClick: () => setSelected(null) }, ...(current ? [{ label: current.title }] : [])]} />
      {current ? (
        <>
          <div className="flex flex-col gap-[14px]">
            <h1 className="t-display">{current.title}</h1>
            {delta && delta.total > 0 && <p className="t-lead m-0">{delta.sentence}</p>}
            {!current.readsIdeas && <p className="t-lead m-0">Kept as {current.roles.map((r) => ROLE_LABEL[r].toLowerCase()).join(', ')} for your goals: used for style, scope and practice, not read into ideas.</p>}
            {current.error && <Notice error>{current.error}</Notice>}
            {current.readsIdeas && current.readOld && current.status !== 'running' && (
              <Notice>Read the old way, into many small ideas. Read it again to get a few lesson-sized ones: ideas you have studied stay, and goals that use it are mapped again.</Notice>
            )}
            {reread?.sourceId === current.id && (reread.error ? <Notice error>{reread.text}</Notice> : current.status !== 'done' && <p className="t-small m-0 text-secondary">{reread.text}</p>)}
            <div className="button-row">
              {current.readsIdeas && current.status !== 'running' && current.chunksDone < current.chunkCount && <Button onClick={() => void call('library.run', { sourceId: current.id })}>Run again</Button>}
              {current.readsIdeas && current.chunkCount > 0 && current.status !== 'running' && current.status !== 'pending' && (
                <Button kind={current.readOld ? 'primary' : 'quiet'} onClick={() => void readAgain(current.id)}>
                  Read again
                </Button>
              )}
              <Button kind="quiet" onClick={() => void remove(current.id)}>
                Remove from library
              </Button>
            </div>
          </div>
          {delta && delta.items.length > 0 && (
            <Section title="Ideas" meta={<ChoiceChips label="Order" options={[{ value: 'source', label: 'In order' }, { value: 'alpha', label: 'A to Z' }]} value={order} onChange={setOrder} small />}>
              <ul className="list-card">
                {sortItems(delta.items, order).map((item) => (
                  <IdeaRow
                    key={item.nodeId}
                    item={item}
                    highlighted={highlight === item.nodeId}
                    inSource={(id) => delta.items.some((i) => i.nodeId === id)}
                    onOpen={(id) => {
                      setHighlight(id);
                      document.getElementById(`idea-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }}
                  />
                ))}
              </ul>
            </Section>
          )}
          {current.readsIdeas && (current.chunkCount > 1 || current.chunks.some((c) => c.error)) && (
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
          )}
        </>
      ) : (
        <Empty>Choose a source to see what it adds for you.</Empty>
      )}
    </Screen>
  );
}

function sortItems(items: DeltaItem[], order: Order): DeltaItem[] {
  return order === 'source' ? items : [...items].sort((a, b) => a.name.localeCompare(b.name));
}

/** "p12" → "p 12", "p12–p14" → "pp 12–14"; headings stay as they are. */
function formatCitation(locator: string): string {
  const range = /^p(\d+)–p(\d+)$/.exec(locator);
  if (range) return `pp ${range[1]}–${range[2]}`;
  const page = /^p(\d+)$/.exec(locator);
  return page ? `p ${page[1]}` : locator;
}

function IdeaRow({ item, highlighted, inSource, onOpen }: { item: DeltaItem; highlighted: boolean; inSource: (id: string) => boolean; onOpen: (id: string) => void }) {
  const refs = (list: IdeaRef[]) =>
    list.map((r, i) => (
      <span key={r.id}>
        {i > 0 && ', '}
        {inSource(r.id) ? (
          <button type="button" className="link-button" onClick={() => onOpen(r.id)}>
            <Markdown text={r.name} inline />
          </button>
        ) : (
          <span className="text-secondary" title="From another source">
            <Markdown text={r.name} inline />
          </span>
        )}
      </span>
    ));
  return (
    <li id={`idea-${item.nodeId}`} className={highlighted ? 'idea-row is-highlighted' : 'idea-row'}>
      <div className="row">
        <Markdown text={item.name} inline className="font-medium" />
        {item.citations.length > 0 && <span className="t-small min-w-0 max-w-[45%] truncate text-muted" title={item.citations.map(formatCitation).join(', ')}>{item.citations.map(formatCitation).join(', ')}</span>}
      </div>
      <Markdown text={item.statement} className="text-soft" />
      {(item.builtOn.length > 0 || item.leadsTo.length > 0) && (
        <div className="t-small flex flex-col gap-[2px] text-muted">
          {item.builtOn.map((premises, i) => (
            <span key={i}>
              {i === 0 ? 'Built on' : 'Or built on'} {refs(premises)}
            </span>
          ))}
          {item.leadsTo.length > 0 && <span>Leads to {refs(item.leadsTo)}</span>}
        </div>
      )}
      <span className={`t-small ${CLASS_TONE[item.cls]}`}>{CLASS_LABEL[item.cls]}</span>
    </li>
  );
}

/** Paste notes, an article or a transcript: it becomes a source like a file. */
function PasteSheet({ onClose, onAdded }: { onClose: () => void; onAdded: (sourceId: string, existed: boolean) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const { sourceId, existed } = await call('library.addText', { title: title.trim() || undefined, text });
      await onAdded(sourceId, existed);
    } catch (e) {
      setError(plainError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Paste text"
      width={620}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" onClick={() => void add()} disabled={busy || text.trim().length === 0}>
            {busy ? 'Adding…' : 'Add to library'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[12px]">
        <p className="m-0">Notes, an article copied from a page, a transcript. It is read into ideas like a file.</p>
        <input className="input" aria-label="Title" placeholder="Title (optional: the first line is used)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="input" aria-label="Text" rows={12} placeholder="Paste here" value={text} onChange={(e) => setText(e.target.value)} data-autofocus />
        {error && <Notice error>{error}</Notice>}
      </div>
    </Dialog>
  );
}
