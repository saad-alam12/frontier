/**
 * What the backend is doing for the session (planning it, judging an answer), for every screen: the
 * Session screen shows it when it opens again, and the sidebar's Session entry says "Thinking…" while it
 * runs and "Your turn" when it finished while the learner was elsewhere. A small module store, because
 * the work outlives the screen that started it.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { SessionWorkEvent, SessionWorkView } from '../../backend/api/contract';
import { call, onEvent } from '../api';
import { clearAnswerExtras } from '../components/AnswerExtras';

interface WorkState {
  work: SessionWorkView | null;
  /** A new card, a planned session or a failure arrived while the Session screen was not open. */
  unseen: boolean;
  /** The last change, so screens can refresh when work finishes. */
  last: SessionWorkEvent | null;
}

let state: WorkState = { work: null, unseen: false, last: null };
let screenOpen = 0;
let started = false;
const listeners = new Set<() => void>();

function update(patch: Partial<WorkState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Start listening once for the app. */
export function startSessionWork(): void {
  if (started) return;
  started = true;
  void call('session.work').then((work) => update({ work }));
  onEvent('session.work', (event) => {
    const finished = event.outcome === 'done' || event.outcome === 'failed';
    // the answer was accepted, so its images and quote are spent, whichever screen is showing
    if (event.outcome === 'done' && event.kind === 'respond') clearAnswerExtras();
    update({ work: event.work, last: event, unseen: screenOpen > 0 ? false : finished || state.unseen });
  });
}

export function useSessionWork(): WorkState {
  return useSyncExternalStore(subscribe, () => state);
}

/** While the Session screen is mounted, whatever arrives is seen. */
export function useSessionScreenOpen(): void {
  useEffect(() => {
    screenOpen += 1;
    update({ unseen: false });
    return () => {
      screenOpen -= 1;
    };
  }, []);
}

/**
 * Plan and open a session without waiting for it: the Session screen shows the planning at once
 * (before the backend's first event arrives) and the session when it is ready. A failure comes back
 * as the work's error, so the promise's own rejection is not needed here.
 */
export function startSessionInBackground(goalId: string, focus?: string[]): void {
  if (state.work?.status === 'running') return;
  const placeholder: SessionWorkView = { kind: 'start', status: 'running', sessionId: null, goalId, since: new Date().toISOString(), sent: null, stoppable: false, error: null, writing: null };
  update({ work: placeholder });
  // an open session comes back at once with no work at all; read the true state then
  const settle = () => {
    if (state.work === placeholder) void call('session.work').then((work) => update({ work }));
  };
  call('session.start', { goalId, focus }).then(settle, settle);
}
