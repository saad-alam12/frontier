/**
 * Active-time ticker (design §10.2). While the window has focus and the learner has done something in
 * the last few minutes, every tick books its seconds to the current surface; the backend attributes
 * them to the session, practice set or goal. Screens declare their surface with `useSurface`.
 */
import { useEffect } from 'react';
import type { TickInput } from '../../backend/api/contract';
import { call } from '../api';

const TICK_SECONDS = 15;
/** Reading a long explanation without touching anything still counts, up to this long. */
const IDLE_MS = 3 * 60_000;

type Surface = Omit<TickInput, 'seconds'>;

let current: Surface | null = null;
let lastInput = Date.now();
let started = false;

/** Start the ticker once for the app. */
export function startActivityTicker(): void {
  if (started) return;
  started = true;
  const mark = () => {
    lastInput = Date.now();
  };
  for (const e of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'scroll']) window.addEventListener(e, mark, { passive: true, capture: true });
  window.setInterval(() => {
    if (!current || !document.hasFocus() || document.visibilityState !== 'visible') return;
    if (Date.now() - lastInput > IDLE_MS) return;
    void call('activity.tick', { ...current, seconds: TICK_SECONDS }).catch(() => undefined);
  }, TICK_SECONDS * 1000);
}

/** While the calling component is mounted, time counts toward this surface. */
export function useSurface(surface: Surface['surface'] | null, options: { goalId?: string | null; practiceSetId?: string | null } = {}): void {
  const { goalId = null, practiceSetId = null } = options;
  useEffect(() => {
    if (!surface) return;
    const mine: Surface = { surface, goalId, practiceSetId };
    current = mine;
    return () => {
      if (current === mine) current = null;
    };
  }, [surface, goalId, practiceSetId]);
}
