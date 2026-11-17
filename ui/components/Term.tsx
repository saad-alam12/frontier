import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { call } from '../api';
import type { TermPeek } from '../../backend/api/contract';
import { locatorLabel } from '../../backend/core/locators';
import { openSource } from '../lib/sourceViewer';
import { TermsScope, useTerms } from '../lib/terms';
import { Markdown } from './Markdown';

/** Hover definitions (R8 E2, design §8): an underlined name of a known idea and its popover. */

const OPEN_DELAY = 250;
const CLOSE_DELAY = 150;
const MARGIN = 8;
const GAP = 6;

/**
 * What was looked up, so a second hover is instant; kept per index, so a new index (the learner learned
 * something, or a card changed) looks everything up afresh.
 */
const lookups = new WeakMap<object, { peeked: Map<string, TermPeek>; pending: Map<string, Promise<TermPeek>> }>();
const NO_INDEX = {};

function cacheFor(index: object | null) {
  const key = index ?? NO_INDEX;
  let cache = lookups.get(key);
  if (!cache) {
    cache = { peeked: new Map(), pending: new Map() };
    lookups.set(key, cache);
  }
  return cache;
}

function lookUp(index: object | null, nodeId: string): Promise<TermPeek> {
  const { peeked, pending } = cacheFor(index);
  const known = peeked.get(nodeId);
  if (known) return Promise.resolve(known);
  let request = pending.get(nodeId);
  if (!request) {
    request = call('terms.peek', { nodeId })
      .then((peek) => {
        peeked.set(nodeId, peek);
        return peek;
      })
      .finally(() => pending.delete(nodeId));
    pending.set(nodeId, request);
  }
  return request;
}

const STANDING = ['You have met it', 'You recognize it', 'You can explain it', 'You can derive it', 'You can apply it', 'You can transfer it'];

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

function standing(peek: TermPeek): string {
  if (!peek.learned) return 'On a flashcard, not learned in a session yet';
  const words = STANDING[peek.learned.depth] ?? STANDING[0];
  return peek.learned.on ? `${words} · learned ${day(peek.learned.on)}` : `${words}`;
}

const FOCUSABLE = 'button, [href], [tabindex]:not([tabindex="-1"])';

/**
 * A name of an idea the learner knows, with a faint underline; hovering or focusing it shows what the
 * idea is and where it sits, without leaving the page (R8 E2).
 */
export function Term({ nodeId, children }: { nodeId: string; children: ReactNode }) {
  const { actions, index } = useTerms();
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState<TermPeek | null>(() => cacheFor(index).peeked.get(nodeId) ?? null);
  const [failed, setFailed] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLSpanElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const popoverId = useId();

  const clearTimers = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  };
  const show = () => {
    clearTimers();
    setOpen(true);
  };
  const close = useCallback(() => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    setOpen(false);
    setPlace(null);
  }, []);
  const hoverIn = () => {
    window.clearTimeout(closeTimer.current);
    if (open) return;
    window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(show, OPEN_DELAY);
  };
  const hoverOut = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(close, CLOSE_DELAY);
  };
  const inside = (node: EventTarget | null) => node instanceof Node && (trigger.current?.contains(node) || popover.current?.contains(node));
  const blurred = (e: React.FocusEvent) => {
    if (!inside(e.relatedTarget)) hoverOut();
  };

  useEffect(() => clearTimers, []);

  // fetch on the first open of this idea
  useEffect(() => {
    if (!open || peek) return;
    let live = true;
    setFailed(false);
    lookUp(index, nodeId).then(
      (found) => live && setPeek(found),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [open, peek, nodeId, index]);

  // a new index means something changed: the next open looks the idea up again
  useEffect(() => setPeek(cacheFor(index).peeked.get(nodeId) ?? null), [index, nodeId]);

  // under the word, or above it when there is no room; inside the window
  const position = useCallback(() => {
    const word = trigger.current;
    const box = popover.current;
    if (!word || !box) return;
    const rect = word.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = box;
    const below = window.innerHeight - rect.bottom - GAP - MARGIN;
    const above = rect.top - GAP - MARGIN;
    const top = below >= height || below >= above ? rect.bottom + GAP : rect.top - GAP - height;
    const left = Math.min(Math.max(rect.left, MARGIN), Math.max(MARGIN, window.innerWidth - width - MARGIN));
    setPlace({ left, top: Math.max(MARGIN, top) });
  }, []);

  useLayoutEffect(() => {
    if (open) position();
  }, [open, peek, failed, position]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (popover.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
      close();
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open, close, position]);

  // the popover sits at the end of the page, so Tab from the word steps into it
  const wordKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || e.shiftKey || !open) return;
    const first = popover.current?.querySelector<HTMLElement>(FOCUSABLE);
    if (first) {
      e.preventDefault();
      first.focus();
    }
  };
  const popoverKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const items = [...(popover.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (e.shiftKey && document.activeElement === items[0]) {
      e.preventDefault();
      trigger.current?.focus({ preventScroll: true });
    } else if (!e.shiftKey && document.activeElement === items[items.length - 1]) {
      close();
    }
  };

  const go = (fn: () => void) => () => {
    close();
    fn();
  };

  return (
    <>
      <span
        ref={trigger}
        className="term"
        tabIndex={0}
        aria-expanded={open}
        aria-describedby={open ? popoverId : undefined}
        onMouseEnter={hoverIn}
        onMouseLeave={hoverOut}
        // keyboard focus opens it at once; a click (or a drag to select text) waits for the hover, so selecting is untouched
        onFocus={(e) => {
          if (e.currentTarget.matches(':focus-visible')) show();
        }}
        onBlur={blurred}
        onKeyDown={wordKey}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={popover}
            id={popoverId}
            role="dialog"
            aria-label={peek?.name ?? 'Idea'}
            className="term-popover"
            style={{ left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? 'visible' : 'hidden' }}
            onMouseEnter={() => window.clearTimeout(closeTimer.current)}
            onMouseLeave={hoverOut}
            onBlur={blurred}
            onKeyDown={popoverKey}
          >
            <TermsScope off>
              {peek ? (
                <PeekBody peek={peek} actions={actions} go={go} />
              ) : (
                <p className="term-quiet">{failed ? 'Could not look this up.' : 'Looking it up…'}</p>
              )}
            </TermsScope>
          </div>,
          document.body,
        )}
    </>
  );
}

function Names({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <p className="term-line">
      <span className="term-label">{label}</span>{' '}
      {names.map((name, i) => (
        <span key={`${i}-${name}`}>
          {i > 0 && ', '}
          <Markdown text={name} inline />
        </span>
      ))}
    </p>
  );
}

function PeekBody({ peek, actions, go }: { peek: TermPeek; actions: ReturnType<typeof useTerms>['actions']; go: (fn: () => void) => () => void }) {
  const used = peek.goals.length > 0 || peek.firstSession || peek.sources.length > 0;
  return (
    <>
      <div className="term-name">
        <Markdown text={peek.name} inline />
      </div>
      <div className="term-definition">
        {peek.ownWords && <div className="term-caption">In your words</div>}
        <Markdown text={peek.definition} />
      </div>
      <p className="term-standing">{standing(peek)}</p>
      <Names label="Built on" names={peek.builtOn} />
      <Names label="Leads to" names={peek.leadsTo} />
      {used && (
        <div className="term-block">
          <div className="term-label">Used in</div>
          {peek.goals.length > 0 && <p className="term-line">{peek.goals.join(', ')}</p>}
          {actions && peek.firstSession && (
            <div>
              <button type="button" className="link-button" onClick={go(() => actions.openTrail(peek.firstSession!.id))}>
                First taught on {day(peek.firstSession.on)}
              </button>
            </div>
          )}
          {actions &&
            peek.sources.map((s) => (
              <div key={`${s.sourceId}-${s.locator ?? ''}`}>
                <button type="button" className="link-button" onClick={go(() => openSource({ sourceId: s.sourceId, locator: s.locator }))}>
                  {s.locator ? `${s.title}, ${locatorLabel(s.locator)}` : s.title}
                </button>
              </div>
            ))}
        </div>
      )}
      {peek.cards.length > 0 && (
        <div className="term-block">
          <div className="term-label">Flashcards</div>
          {peek.cards.map((card) => (
            <div key={card.id} className="term-card">
              <Markdown text={card.front} />
              <div className="term-card-back">
                <Markdown text={card.back} />
              </div>
            </div>
          ))}
          {actions && (
            <button type="button" className="link-button" onClick={go(actions.openCards)}>
              See your flashcards
            </button>
          )}
        </div>
      )}
      {actions && (
        <div className="term-block">
          <button type="button" className="link-button" onClick={go(() => actions.showOnMap(peek.nodeId))}>
            Open in the map
          </button>
        </div>
      )}
    </>
  );
}
