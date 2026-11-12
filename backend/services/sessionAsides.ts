/**
 * What the learner asked the tutor while a card was open: kept as session events, read back per card.
 */
import type { AsideMode } from '../agents/tutor';
import type { Stage } from '../core/session';
import type { Database } from '../store/db';
import { listSessionEvents } from '../store/sessions';

/** Something the learner asked the tutor while a card was open, and what the tutor said. Not graded. */
export interface Aside {
  id: string;
  mode: AsideMode;
  /** The learner's own words; empty when they asked for the explanation in another form. */
  question: string;
  answer: string;
}

export function asideOf(event: { id: string; payload: Record<string, unknown> }): Aside | null {
  const p = event.payload as { mode?: AsideMode; question?: string; answer?: string };
  return p.mode && typeof p.answer === 'string' ? { id: event.id, mode: p.mode, question: p.question ?? '', answer: p.answer } : null;
}

export const hintsTaken = (asides: Aside[]) => asides.filter((a) => a.mode === 'hint').length;

/** What was asked about the card that is open now: the asides since that card was shown. */
export function openAsides(db: Database, sessionId: string, nodeId: string, stage: Stage): Aside[] {
  let asides: Aside[] = [];
  for (const event of listSessionEvents(db, sessionId)) {
    const p = event.payload as { nodeId?: string; stage?: Stage };
    if (p.nodeId !== nodeId || p.stage !== stage) continue;
    if (event.kind === 'card') asides = [];
    else if (event.kind === 'aside') {
      const aside = asideOf(event);
      if (aside) asides.push(aside);
    }
  }
  return asides;
}
