import { Fragment, useCallback, useEffect, useState } from 'react';
import { call, onEvent } from '../api';
import type { DeltaClass, DeltaItem, DeltaSummary, IdeaRef, SourceSummary } from '../../backend/api/contract';
import { WatchedFolders } from '../components/WatchedFolders';
import { Breadcrumb, Screen } from '../components/Shell';
import { Button, ChoiceChips, Empty, Meter, Notice, Section } from '../components/controls';
import { Markdown } from '../components/Markdown';
import { Dialog } from '../components/Dialog';
import { plainError } from '../lib/errors';
import { openSource } from '../lib/sourceViewer';
import { locatorLabel } from '../../backend/core/locators';
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
  const [linking, setLinking] = useState(false);

  const refresh = useCallback(async () => {
    const list = await call('library.list');
    setSources(list);
    setSelected((current) => current ?? list[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void refresh();
    return onEvent('library.progress', (p) => {
      void refresh();
      // "Part 2 failed: <what the model service said>": the part stays, the reason is put in plain words
      if (p.message) setNotice(p.message.replace(/^(Part \d+ failed): ([\s\S]*)$/, (_all, part: string, why: string) => `${part}. ${plainError(why)}`));
    });
  }, [refresh]);

  // the time left on a source being read is a guess that runs down: ask again while one is read
  const reading = sources.some((s) => s.queued);
  useEffect(() => {
    if (!reading) return;
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [reading, refresh]);

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

  const failed = (e: unknown) => setNotice(plainError(e instanceof Error ? e.message : String(e)));
  const remove = async (id: string) => {
    try {
      await call('library.remove', { sourceId: id });
      setSelected(null);
      await refresh();
    } catch (e) {
      failed(e);
    }
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
      <Button onClick={() => setLinking(true)} disabled={busy}>
        Add a link
      </Button>
      <Button onClick={() => setPasting(true)} disabled={busy}>
        Paste text
      </Button>
      <Button kind="primary" onClick={() => void addFiles()} disabled={busy}>
        {busy ? 'Adding…' : 'Add files'}
      </Button>
    </div>
  );
  const added = async (sourceId: string, existed: boolean) => {
    setPasting(false);
    setLinking(false);
    setNotice(existed ? 'That is already in the library.' : null);
    await refresh();
    setSelected(sourceId);
  };
  const pasteSheet = (
    <>
      {pasting && <PasteSheet onClose={() => setPasting(false)} onAdded={added} />}
      {linking && (
        <LinkSheet
          onClose={() => setLinking(false)}
          onAdded={added}
          onPasteInstead={() => {
            setLinking(false);
            setPasting(true);
          }}
        />
      )}
    </>
  );

  if (sources.length === 0) {
    return (
      <Screen>
        <div className="flex flex-col gap-[10px]">
          <h1 className="t-display">Library</h1>
          <p className="t-lead m-0">The material your maps are built from.</p>
        </div>
        {notice && <Notice error>{notice}</Notice>}
        <Empty action={addButton}>Add a lecture PDF, slides, a Word document, an EPUB book, a notebook or notes, a web page by its link, or paste text. Each is read into ideas and the reasoning between them, then compared with what you know.</Empty>
        <WatchedFolders onChanged={() => void refresh()} />
        {pasteSheet}
      </Screen>
    );
  }

  const aside = (
    <>
      <h2 className="t-title">Sources</h2>
      {addButton}
      {notice && <Notice error>{notice}</Notice>}
      <ul className="list-card">
        {sources.map((s) => (
          <li key={s.id}>
            <button type="button" className="row" onClick={() => setSelected(s.id)} aria-current={s.id === selected ? 'true' : undefined}>
              <span className="flex min-w-0 flex-col">
                <span className={'truncate ' + (s.id === selected ? 'font-medium text-text' : 'text-soft')}>{s.title}</span>
                <span className="t-small text-muted">{s.readsIdeas ? `${s.nodeCount} ideas · ${s.stopped ? 'Stopped' : STATUS_LABEL[s.status]}` : `Kept as ${s.roles.map((r) => ROLE_LABEL[r].toLowerCase()).join(', ')}`}</span>
              </span>
              {s.readsIdeas && s.chunkCount > 0 && <Meter value={s.chunksDone / s.chunkCount} accent={s.status === 'running'} />}
            </button>
          </li>
        ))}
      </ul>
      <WatchedFolders onChanged={() => void refresh()} />
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
            {current.origin && (
              <a className="t-small text-secondary" href={current.origin} target="_blank" rel="noreferrer">
                From {hostOf(current.origin)}
              </a>
            )}
            {delta && delta.total > 0 && <p className="t-lead m-0">{delta.sentence}</p>}
            {current.readsIdeas && current.pictures > 0 && (
              <p className="t-small m-0 text-secondary">
                {current.pictures === 1 ? '1 page is mostly a figure: it was' : `${current.pictures} pages are mostly figures: they were`} read from {current.pictures === 1 ? 'its picture' : 'their pictures'}, and the tutor can show {current.pictures === 1 ? 'it' : 'them'} in a session.
              </p>
            )}
            {!current.readsIdeas && <p className="t-lead m-0">Kept as {current.roles.map((r) => ROLE_LABEL[r].toLowerCase()).join(', ')} for your goals: used for style, scope and practice, not read into ideas.</p>}
            {current.readsIdeas && current.queued && (
              <p className="t-small m-0 text-secondary" role="status">
                {readingLine(current)}
              </p>
            )}
            {current.error && (current.stopped ? <Notice>{current.error}</Notice> : <Notice error>{current.error}</Notice>)}
            {current.readsIdeas && current.readOld && current.status !== 'running' && (
              <Notice>Read the old way, into many small ideas. Read it again to get a few lesson-sized ones: ideas you have studied stay, and goals that use it are mapped again.</Notice>
            )}
            {reread?.sourceId === current.id && (reread.error ? <Notice error>{reread.text}</Notice> : current.status !== 'done' && <p className="t-small m-0 text-secondary">{reread.text}</p>)}
            <div className="button-row">
              {current.queued && (
                <Button onClick={() => void call('library.stop', { sourceId: current.id }).then(refresh, failed)} title="What was read so far stays. The rest waits until you run it again.">
                  Stop reading
                </Button>
              )}
              {current.readsIdeas && !current.queued && current.status !== 'running' && current.chunksDone < current.chunkCount && (
                <Button kind={current.stopped ? 'primary' : 'secondary'} onClick={() => void call('library.run', { sourceId: current.id }).then(refresh, failed)}>
                  Run again
                </Button>
              )}
              {current.readsIdeas && current.chunkCount > 0 && current.status !== 'running' && current.status !== 'pending' && (
                <Button kind={current.readOld ? 'primary' : 'quiet'} onClick={() => void readAgain(current.id)}>
                  Read again
                </Button>
              )}
              {(current.chunkCount > 0 || (current.kind === 'pdf' && current.path)) && <Button onClick={() => openSource({ sourceId: current.id, locator: null })}>Read</Button>}
              {current.path && (
                <Button kind="quiet" onClick={() => void call('library.openOriginal', { sourceId: current.id }).catch(failed)}>
                  Open original
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
                    sourceId={current.id}
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
                    <span className="t-small min-w-0 text-right text-muted">
                      {c.status === 'done' ? `${c.nodeCount} ideas` : c.status === 'failed' ? 'Failed' : STATUS_LABEL[c.status]}
                      {c.error && (
                        <span className="block text-danger" title={c.error}>
                          {plainError(c.error)}
                        </span>
                      )}
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


function IdeaRow({ item, sourceId, highlighted, inSource, onOpen }: { item: DeltaItem; sourceId: string; highlighted: boolean; inSource: (id: string) => boolean; onOpen: (id: string) => void }) {
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
        {item.citations.length > 0 && (
          <span className="t-small min-w-0 max-w-[45%] truncate text-muted" title={item.citations.map(locatorLabel).join(', ')}>
            {item.citations.map((c, i) => (
              <Fragment key={c}>
                {i > 0 && ', '}
                <button type="button" className="link-button citation-link" title="Open the source here" onClick={() => openSource({ sourceId, locator: c, ideas: [{ id: item.nodeId, name: item.name }] })}>
                  {locatorLabel(c)}
                </button>
              </Fragment>
            ))}
          </span>
        )}
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

/** What a source being read says about itself: its turn, its part and about how long it still takes. */
function readingLine(source: SourceSummary): string {
  if (source.secondsLeft === null) return 'Waiting its turn: other sources are being read first.';
  const part = source.chunkCount > 1 ? ` Part ${Math.min(source.chunkCount, source.chunksDone + 1)} of ${source.chunkCount}.` : '';
  const left = source.secondsLeft;
  if (left <= 0) return `Reading.${part} It is taking longer than usual.`;
  return `Reading.${part} About ${left < 50 ? `${Math.max(10, Math.round(left / 10) * 10)} seconds` : left < 100 ? 'a minute' : `${Math.round(left / 60)} minutes`} left.`;
}

/** "en.wikipedia.org" for the line that says where a source came from. */
function hostOf(address: string): string {
  try {
    return new URL(address).hostname.replace(/^www\./, '');
  } catch {
    return address;
  }
}

/**
 * Add a source by its web address. A page or a PDF is fetched and read like a file. A video is not
 * fetched: the sheet asks for its transcript, copied from the video's page, and keeps the link with it.
 */
function LinkSheet({ onClose, onAdded, onPasteInstead }: { onClose: () => void; onAdded: (sourceId: string, existed: boolean) => Promise<void>; onPasteInstead: () => void }) {
  const [url, setUrl] = useState('');
  const [video, setVideo] = useState<{ url: string } | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(plainError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };
  const fetchLink = () =>
    run(async () => {
      const result = await call('library.addLink', { url });
      if (result.state === 'added') await onAdded(result.sourceId, result.existed);
      else {
        setVideo({ url: result.url });
        setTitle(result.title);
      }
    });
  const addTranscript = () =>
    run(async () => {
      if (!video) return;
      const { sourceId, existed } = await call('library.addText', { title: title.trim() || undefined, text, origin: video.url });
      await onAdded(sourceId, existed);
    });
  if (video) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Paste the video's transcript"
        width={620}
        actions={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button kind="primary" onClick={() => void addTranscript()} disabled={busy || text.trim().length === 0}>
              {busy ? 'Adding…' : 'Add to library'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-[12px]">
          <p className="m-0">
            Frontier cannot fetch a video's transcript by itself. On{' '}
            <a href={video.url} target="_blank" rel="noreferrer">
              the video's page
            </a>
            , open the description, choose "Show transcript", select the whole transcript and copy it. Paste it here with its time stamps: ideas then say where in the video they come from.
          </p>
          <input className="input" aria-label="Title" placeholder="Title of the video" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="input" aria-label="Transcript" rows={12} placeholder="Paste the transcript here" value={text} onChange={(e) => setText(e.target.value)} data-autofocus />
          {error && <Notice error>{error}</Notice>}
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a link"
      width={560}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" onClick={() => void fetchLink()} disabled={busy || url.trim().length === 0}>
            {busy ? 'Fetching…' : 'Add to library'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-[12px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && url.trim()) void fetchLink();
        }}
      >
        <p className="m-0">An article, a page of notes or a PDF by its web address, or a video on YouTube. A page is fetched once and read like a file. For a video you paste its transcript.</p>
        <input className="input" aria-label="Web address" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} data-autofocus />
        {error && (
          <>
            <Notice error>{error}</Notice>
            <button type="button" className="link-button self-start" onClick={onPasteInstead}>
              Paste the text instead
            </button>
          </>
        )}
      </form>
    </Dialog>
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
