import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, GalleryVerticalEnd, GraduationCap, MessageCircleQuestion, X } from 'lucide-react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { call, isCancelled } from '../api';
import type { LookupAnswer, SourceDocument } from '../../backend/api/contract';
import { citedPage, locatorLabel } from '../../backend/core/locators';
import { plainError } from '../lib/errors';
import { openSource, type SourceTarget } from '../lib/sourceViewer';
import { CardSheet, type CardSheetStart } from './CardSheet';
import { Markdown } from './Markdown';
import { Notice } from './controls';
import './Cards.css';

/** Pages are drawn to fit the column, but never larger than this: a page wider than about 1,000 pixels reads badly. */
const MAX_SCALE = 1.6;

interface Selected {
  text: string;
  /** The page or part the selection is in, as text: what a flashcard is drafted from around it. */
  context: string;
  locator: string | null;
  top: number;
  left: number;
}

type Explanation = { state: 'asking'; text: string } | { state: 'done'; text: string; answer: LookupAnswer } | { state: 'failed'; text: string; error: string };

/**
 * The source viewer (B5, design §8 "Sources"): a PDF drawn page by page at the cited page, or the text
 * of a source's parts at the cited part. Select text and a bar offers Explain (Lookup reads the
 * passage with the learner's map), Make a flashcard, or Learn it now (a session made from it).
 */
export function SourceViewer({ target, onClose, onLearn }: { target: SourceTarget; onClose: () => void; onLearn: (description: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const pageArea = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<SourceDocument | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(citedPage(target.locator) ?? 1);
  const [pageInput, setPageInput] = useState(String(citedPage(target.locator) ?? 1));
  const [width, setWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [cardSheet, setCardSheet] = useState<CardSheetStart | null>(null);

  useEffect(() => {
    ref.current?.showModal();
    // the page has the focus, so the arrow keys turn pages at once
    pageArea.current?.focus();
  }, []);

  // the source, and for a PDF its document, drawn by pdf.js (loaded only when a PDF is opened)
  useEffect(() => {
    let live = true;
    let task: PDFDocumentLoadingTask | null = null;
    void (async () => {
      try {
        const d = await call('library.document', { sourceId: target.sourceId });
        if (!live) return;
        setDoc(d);
        if (!d.pdf) return;
        const pdfjs = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        task = pdfjs.getDocument({ data: d.pdf, verbosity: 0 });
        const loaded = await task.promise;
        if (!live) return;
        setPdf(loaded);
        const first = Math.min(Math.max(1, citedPage(target.locator) ?? 1), loaded.numPages);
        setPage(first);
        setPageInput(String(first));
      } catch (e) {
        if (live) setError(plainError(e instanceof Error ? e.message : String(e)));
      }
    })();
    return () => {
      live = false;
      void task?.destroy();
    };
  }, [target.sourceId]);

  // pages fit the column's width, and follow it when the window is resized
  useEffect(() => {
    const el = pageArea.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(el);
      setWidth(Math.floor(el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [doc]);

  const pages = pdf?.numPages ?? 0;
  const go = useCallback(
    (n: number) => {
      if (!pages) return;
      const next = Math.min(pages, Math.max(1, n));
      setPage(next);
      setPageInput(String(next));
      setSelected(null);
      pageArea.current?.scrollTo({ top: 0 });
    },
    [pages],
  );

  // ← and → turn pages, unless the learner is typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (cardSheet || (e.target instanceof HTMLElement && e.target.closest('input, textarea'))) return;
      if (e.key === 'ArrowRight') go(page + 1);
      if (e.key === 'ArrowLeft') go(page - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, page, cardSheet]);

  // a selection inside the page shows the bar of what can be done with it
  useEffect(() => {
    const place = () => setSelected(selectionIn(pageArea.current, pdf ? `p${page}` : null));
    document.addEventListener('selectionchange', place);
    pageArea.current?.addEventListener('scroll', place);
    const area = pageArea.current;
    return () => {
      document.removeEventListener('selectionchange', place);
      area?.removeEventListener('scroll', place);
    };
  }, [pdf, page, doc]);

  const explain = async (s: Selected) => {
    setExplanation({ state: 'asking', text: s.text });
    try {
      const answer = await call('lookup.search', { query: 'What does this passage mean?', passage: { sourceId: target.sourceId, locator: s.locator, text: s.text } });
      setExplanation({ state: 'done', text: s.text, answer });
    } catch (e) {
      if (!isCancelled(e)) setExplanation({ state: 'failed', text: s.text, error: plainError(e instanceof Error ? e.message : String(e)) });
    }
  };
  const clear = () => {
    document.getSelection()?.removeAllRanges();
    setSelected(null);
  };

  const where = doc ? (selected?.locator ? `${doc.title}, ${locatorLabel(selected.locator)}` : doc.title) : '';
  return (
    <dialog
      ref={ref}
      className="viewer"
      aria-label={doc ? `${doc.title}, the source` : 'The source'}
      onCancel={(e) => {
        e.preventDefault();
        if (!cardSheet) onClose();
      }}
    >
      <header className="viewer-head">
        <div className="viewer-title">
          <span className="truncate">{doc?.title ?? 'Opening the source…'}</span>
          {!pdf && target.locator && <span className="shrink-0 text-muted">{locatorLabel(target.locator)}</span>}
        </div>
        {pages > 0 && (
          <nav className="viewer-pages" aria-label="Pages">
            <button type="button" className="icon-button" aria-label="Previous page" disabled={page <= 1} onClick={() => go(page - 1)}>
              <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                go(Number(pageInput) || page);
              }}
            >
              <input className="input viewer-page-input" aria-label="Page" inputMode="numeric" value={pageInput} onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))} onBlur={() => go(Number(pageInput) || page)} />
            </form>
            <span className="t-small text-muted">of {pages}</span>
            <button type="button" className="icon-button" aria-label="Next page" disabled={page >= pages} onClick={() => go(page + 1)}>
              <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </nav>
        )}
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </header>

      <div className="viewer-body">
        <div className="viewer-page" ref={pageArea} tabIndex={-1}>
          {error && <Notice error>{error}</Notice>}
          {pdf && width > 0 && <PdfPage key={page} doc={pdf} number={page} width={width} onError={setError} />}
          {doc && !doc.pdf && <TextParts parts={doc.parts} locator={target.locator} />}
          {doc?.pdf && !pdf && !error && <p className="t-small text-muted">Drawing the pages…</p>}
        </div>
        {explanation && (
          <aside className="viewer-explain" aria-label="Explanation">
            <div className="section-head">
              <span className="panel-label">Explained</span>
              <button type="button" className="icon-button" aria-label="Close the explanation" onClick={() => setExplanation(null)}>
                <X size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <blockquote className="viewer-quote">{explanation.text.length > 280 ? `${explanation.text.slice(0, 280)}…` : explanation.text}</blockquote>
            {explanation.state === 'asking' && <p className="t-small text-muted">Reading it with your map…</p>}
            {explanation.state === 'failed' && <Notice error>{explanation.error}</Notice>}
            {explanation.state === 'done' && <ExplanationBody answer={explanation.answer} currentSource={target.sourceId} onPage={go} />}
          </aside>
        )}
      </div>

      {selected && !cardSheet && (
        <div className="selection-bar" role="toolbar" aria-label="Selected text" style={{ top: selected.top, left: selected.left }} onMouseDown={(e) => e.preventDefault()}>
          <button
            type="button"
            onClick={() => {
              void explain(selected);
              clear();
            }}
          >
            <MessageCircleQuestion size={14} strokeWidth={1.75} aria-hidden="true" />
            Explain
          </button>
          <button
            type="button"
            onClick={() => {
              setCardSheet({ mode: 'selection', selection: { text: selected.text, message: selected.context } });
              clear();
            }}
          >
            <GalleryVerticalEnd size={14} strokeWidth={1.75} aria-hidden="true" />
            Make a flashcard
          </button>
          <button
            type="button"
            onClick={() => {
              const text = selected.text.length > 1200 ? `${selected.text.slice(0, 1200)}…` : selected.text;
              clear();
              onLearn(`What this passage of ${where} says: "${text}"`);
            }}
          >
            <GraduationCap size={14} strokeWidth={1.75} aria-hidden="true" />
            Learn it now
          </button>
        </div>
      )}
      {cardSheet && <CardSheet start={cardSheet} ideas={target.ideas ?? []} onClose={() => setCardSheet(null)} />}
    </dialog>
  );
}

/** One PDF page: drawn on a canvas, with pdf.js's invisible text over it so it can be selected. */
function PdfPage({ doc, number, width, onError }: { doc: PDFDocumentProxy; number: number; width: number; onError: (message: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    let live = true;
    let stop: (() => void) | null = null;
    void (async () => {
      const { TextLayer } = await import('pdfjs-dist');
      const page = await doc.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(MAX_SCALE, width / base.width);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const text = textRef.current;
      if (!live || !canvas || !text) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      setSize({ width: Math.floor(viewport.width), height: Math.floor(viewport.height) });
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This page could not be drawn.');
      // a white page, as it is printed
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const render = page.render({ canvas, canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      const layer = new TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport });
      stop = () => {
        render.cancel();
        layer.cancel();
      };
      text.replaceChildren();
      text.style.setProperty('--total-scale-factor', String(scale));
      await Promise.all([render.promise, layer.render()]);
    })().catch((e: unknown) => {
      const name = e instanceof Error ? e.name : '';
      if (live && name !== 'RenderingCancelledException' && name !== 'AbortException') onError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [doc, number, width, onError]);
  return (
    <div className="pdf-page" style={size ? { width: size.width, height: size.height } : undefined} data-page={number}>
      <canvas ref={canvasRef} style={size ? { width: size.width, height: size.height } : undefined} aria-label={`Page ${number}`} />
      <div className="pdf-text" ref={textRef} />
    </div>
  );
}

/** A source that is not a PDF (or whose copy is gone): its parts as text, the cited one marked and in view. */
function TextParts({ parts, locator }: { parts: SourceDocument['parts']; locator: string | null }) {
  // the part with this locator, or else the one it falls under (a heading cited with its section)
  const exact = parts.findIndex((p) => p.locator === locator);
  const at = exact >= 0 ? exact : parts.findIndex((p) => locator !== null && (locator.startsWith(p.locator) || p.locator.startsWith(locator)));
  const citedRef = useRef<HTMLElement>(null);
  useEffect(() => {
    citedRef.current?.scrollIntoView({ block: 'start' });
  }, [at]);
  return (
    <div className="viewer-text">
      {parts.map((p, i) => (
        <section key={i} ref={i === at ? citedRef : undefined} className={i === at ? 'viewer-part is-cited' : 'viewer-part'} data-locator={p.locator}>
          <div className="t-caption text-muted">{locatorLabel(p.locator)}</div>
          <p className="m-0 whitespace-pre-wrap">{p.text}</p>
        </section>
      ))}
    </div>
  );
}

/** Lookup's answer about the passage: what it rests on, and the other passages it quotes (a page of this source opens here). */
function ExplanationBody({ answer, currentSource, onPage }: { answer: LookupAnswer; currentSource: string; onPage: (page: number) => void }) {
  if (answer.answerError) return <Notice error detail={answer.answerError}>The explanation could not be written.</Notice>;
  if (!answer.answer) return <p className="t-small text-muted">Nothing on your map or in your sources says more about this yet.</p>;
  const quoted = answer.answer.passages.map((id) => answer.passages.find((p) => p.id === id)).filter((p) => p !== undefined);
  const restsOn = answer.answer.cited.map((id) => answer.hits.find((h) => h.nodeId === id)).filter((h) => h !== undefined);
  return (
    <div className="flex flex-col gap-[12px]">
      <Markdown text={answer.answer.text} />
      {restsOn.length > 0 && (
        <div className="idea-links">
          <span className="t-small text-muted">Rests on</span>
          {restsOn.map((h) => (
            <span key={h.nodeId} className="t-small text-secondary">
              <Markdown text={h.name} inline />
            </span>
          ))}
        </div>
      )}
      {quoted.length > 0 && (
        <div className="idea-links">
          <span className="t-small text-muted">Quotes</span>
          {quoted.map((p) => {
            const page = citedPage(p.locator);
            const label = p.locator ? `${p.title}, ${locatorLabel(p.locator)}` : p.title;
            return (
              <button key={p.id} type="button" className="link-button t-small" onClick={() => (p.sourceId === currentSource && page ? onPage(page) : openSource({ sourceId: p.sourceId, locator: p.locator }))}>
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The selection inside the page area, with the text around it and where to show the bar; null when there is none. */
function selectionIn(area: HTMLElement | null, pageLocator: string | null): Selected | null {
  const selection = document.getSelection();
  if (!area || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const element = node instanceof Element ? node : node.parentElement;
  if (!element || !area.contains(element)) return null;
  const text = selection.toString().replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const holder = element.closest<HTMLElement>('.pdf-page, .viewer-part');
  const rect = range.getBoundingClientRect();
  return {
    text,
    context: (holder?.textContent ?? text).replace(/\s+/g, ' ').trim(),
    locator: pageLocator ?? holder?.dataset['locator'] ?? null,
    top: rect.top,
    left: rect.left + rect.width / 2,
  };
}
