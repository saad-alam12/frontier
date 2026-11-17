/**
 * Hover definitions in the window (R8 E2, design §8): the index of names, whether to underline at all,
 * which ideas not to underline here, and where a popover's links go. The App provides it; a screen
 * narrows it with `TermsScope` (the idea a question asks about, or none at all on the Cards screen);
 * `Markdown` reads it.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { buildTermIndex } from '../../backend/core/terms';
import type { TermIndex } from '../../backend/core/terms';
import { call, onEvent } from '../api';

/** Where a popover's links lead; the App's navigation. */
export interface TermActions {
  showOnMap: (nodeId: string) => void;
  openTrail: (sessionId: string) => void;
  openCards: () => void;
}

interface TermsState {
  index: TermIndex | null;
  /** Ideas not underlined here: what the open question asks about. */
  exclude: ReadonlySet<string>;
  /** False where nothing is underlined (the setting is off, the Cards screen, an open practice problem). */
  on: boolean;
  actions: TermActions | null;
}

const NOTHING: ReadonlySet<string> = new Set();
const TermsContext = createContext<TermsState>({ index: null, exclude: NOTHING, on: false, actions: null });

export function useTerms(): TermsState {
  return useContext(TermsContext);
}

/**
 * The index for the whole window. It is asked for again when `refreshKey` changes (another place is
 * opened) and when an answer or a card may have taught a name; the backend answers with nothing while
 * the copy here still holds, so asking costs little.
 */
export function TermsProvider({ refreshKey, actions, children }: { refreshKey: string; actions: TermActions; children: ReactNode }) {
  const [index, setIndex] = useState<TermIndex | null>(null);
  const [show, setShow] = useState(true);
  const version = useRef<string | undefined>(undefined);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const again = () => setTick((t) => t + 1);
    // an answer judged or a card saved may have taught a name
    const offs = [onEvent('cards.changed', again), onEvent('session.work', again), onEvent('goals.changed', again)];
    return () => offs.forEach((off) => off());
  }, []);

  useEffect(() => {
    let live = true;
    void call('terms.preference').then((p) => live && setShow(p.show));
    void call('terms.index', { since: version.current }).then((view) => {
      if (!live || !view) return;
      version.current = view.version;
      setIndex(buildTermIndex(view.terms));
    });
    return () => {
      live = false;
    };
  }, [refreshKey, tick]);

  const value = useMemo<TermsState>(() => ({ index, exclude: NOTHING, on: show, actions }), [index, show, actions]);
  return <TermsContext.Provider value={value}>{children}</TermsContext.Provider>;
}

/** Narrow the definitions for what is inside: leave out the ideas a question asks about, or show none at all. */
export function TermsScope({ exclude, off, children }: { exclude?: Iterable<string | null | undefined>; off?: boolean; children: ReactNode }) {
  const outer = useTerms();
  // the ids are compared by their joined key, not by the array made on each render
  const key = [...(exclude ?? [])].filter((id): id is string => Boolean(id)).join(',');
  const value = useMemo<TermsState>(() => {
    const ids = key ? key.split(',') : [];
    return { ...outer, on: outer.on && !off, exclude: ids.length ? new Set([...outer.exclude, ...ids]) : outer.exclude };
  }, [outer, off, key]);
  return <TermsContext.Provider value={value}>{children}</TermsContext.Provider>;
}
