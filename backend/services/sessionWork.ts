/**
 * Work on a session that runs in the backend whether or not the Session screen is open (design §4.3):
 * planning and opening a session, and judging an answer. The renderer reads it with the snapshot and
 * hears about every change, so leaving the screen never loses what was sent, and coming back shows the
 * true state: still running (with the answer as sent), finished, or failed with its error.
 */
import type { LearnerResponse } from '../agents/tutor';
import type { Stage } from '../core/session';
import { CommitGate } from '../llm/cancel';
import { isCancelled } from '../llm/provider';
import { nowIso } from '../store/db';
import type { PublicCard } from './session';

export type WorkKind = 'start' | 'respond';

/** An answer as the learner sent it, with the card it answers (none for a free recall or "Begin"). */
export interface SentAnswer {
  card: PublicCard | null;
  stage: Stage | null;
  response: LearnerResponse;
}

export interface SessionWorkView {
  kind: WorkKind;
  status: 'running' | 'failed';
  /** The session it works on; null while a new session is being planned. */
  sessionId: string | null;
  goalId: string | null;
  since: string;
  sent: SentAnswer | null;
  /** While true, Esc stops it and the answer goes back to the field. */
  stoppable: boolean;
  error: string | null;
}

export interface SessionWorkEvent {
  /** `cleared`: a kept failure was dropped because its session ended. */
  outcome: 'running' | 'done' | 'failed' | 'stopped' | 'cleared';
  kind: WorkKind;
  /** For a finished start, the session it opened. */
  sessionId: string | null;
  /** The work as it stands after this change. */
  work: SessionWorkView | null;
}

export interface WorkJob {
  kind: WorkKind;
  sessionId: string | null;
  goalId: string | null;
  sent: SentAnswer | null;
  /** Only answers to questions can be stopped (graded cards and free recall). */
  stoppable: boolean;
}

interface Entry extends WorkJob {
  status: SessionWorkView['status'];
  since: string;
  error: string | null;
  gate: CommitGate | null;
}

/**
 * At most one piece of work at a time: there is one open session, a session refuses a second answer
 * while one is judged, and a session is planned only when none is open. A failure is kept until the
 * next piece of work replaces it (or its session ends), so the screen can show it whenever it opens.
 */
export class SessionWork {
  private entry: Entry | null = null;
  private readonly listeners = new Set<(event: SessionWorkEvent) => void>();

  current(): SessionWorkView | null {
    return this.entry ? view(this.entry) : null;
  }

  /** The work on this session, if any. */
  forSession(sessionId: string): SessionWorkView | null {
    return this.entry?.sessionId === sessionId ? view(this.entry) : null;
  }

  /**
   * Run `fn` as the session's work. A stoppable job gets a commit gate for its model calls. Refused,
   * changing nothing, while other work runs. `opened` names the session a finished start opened.
   */
  async run<T>(job: WorkJob, fn: (gate: CommitGate | null) => Promise<T>, opened?: (result: T) => string): Promise<T> {
    const running = this.entry?.status === 'running' ? this.entry : null;
    if (running) throw new Error(running.kind === 'respond' ? 'Still working on your last answer.' : 'Your session is still being planned.');
    const gate = job.stoppable ? new CommitGate(() => this.notify('running', job.kind, job.sessionId)) : null;
    const entry: Entry = { ...job, status: 'running', since: nowIso(), error: null, gate };
    this.entry = entry;
    this.notify('running', job.kind, job.sessionId);
    try {
      const result = await fn(gate);
      if (this.entry === entry) this.entry = null;
      this.notify('done', job.kind, opened ? opened(result) : job.sessionId);
      return result;
    } catch (error) {
      const stopped = isCancelled(error);
      if (this.entry === entry) this.entry = stopped ? null : { ...entry, status: 'failed', error: error instanceof Error ? error.message : String(error), gate: null };
      this.notify(stopped ? 'stopped' : 'failed', job.kind, job.sessionId);
      throw error;
    }
  }

  /** Stop the answer being judged on this session, if it can still stop. True when it will. */
  cancel(sessionId: string): boolean {
    const entry = this.entry;
    if (entry?.status !== 'running' || entry.sessionId !== sessionId || !entry.gate) return false;
    return entry.gate.cancel();
  }

  /** The session ended: a failure kept for it no longer matters. */
  forget(sessionId: string): void {
    if (this.entry?.status === 'failed' && this.entry.sessionId === sessionId) {
      this.entry = null;
      this.notify('cleared', 'respond', sessionId);
    }
  }

  subscribe(listener: (event: SessionWorkEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(outcome: SessionWorkEvent['outcome'], kind: WorkKind, sessionId: string | null): void {
    const event: SessionWorkEvent = { outcome, kind, sessionId, work: this.current() };
    for (const listener of this.listeners) listener(event);
  }
}

function view(entry: Entry): SessionWorkView {
  return {
    kind: entry.kind,
    status: entry.status,
    sessionId: entry.sessionId,
    goalId: entry.goalId,
    since: entry.since,
    sent: entry.sent,
    stoppable: entry.status === 'running' && (entry.gate?.stoppable ?? false),
    error: entry.error,
  };
}
