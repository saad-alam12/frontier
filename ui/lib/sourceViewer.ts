/**
 * Opening a source in the viewer from anywhere (B5): a citation on an idea's card, a passage in
 * Lookup, a source in the Library. The app shell shows the viewer; screens only say what to open.
 */
import type { IdeaRef } from '../../backend/api/contract';

export interface SourceTarget {
  sourceId: string;
  /** Where to open it: a page ("p12", "p2–p4") or a part's heading; null for the start. */
  locator: string | null;
  /** Ideas a flashcard made from the source starts tagged with (the idea whose citation was opened). */
  ideas?: IdeaRef[];
}

type Listener = (target: SourceTarget) => void;
let listener: Listener | null = null;

export function openSource(target: SourceTarget): void {
  listener?.(target);
}

/** The shell listens; the returned function stops it. */
export function onOpenSource(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}
