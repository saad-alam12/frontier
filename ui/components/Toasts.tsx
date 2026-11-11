import { useEffect, useState } from 'react';
import { onEvent } from '../api';
import { plainError } from '../lib/errors';

interface Toast {
  id: number;
  kind: 'info' | 'error';
  message: string;
}

const SHOWN = 3;
const STAYS_MS = { info: 8000, error: 16000 };

/**
 * Messages from work that runs in the background (a grade that failed, flashcards that could not be
 * written, a file that could not be read): the place that caused them may no longer be on screen, so
 * they show in a corner of the window for a while, wherever the learner is.
 */
export function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    let next = 1;
    const timers = new Set<number>();
    const off = onEvent('app.toast', ({ kind, message }) => {
      const id = next++;
      const text = kind === 'error' ? plainError(message) : message;
      // the same message arriving again (three grades failing for one reason) is shown once
      setToasts((list) => (list.some((t) => t.message === text) ? list : [...list, { id, kind, message: text }].slice(-SHOWN)));
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        setToasts((list) => list.filter((t) => t.id !== id));
      }, STAYS_MS[kind]);
      timers.add(timer);
    });
    return () => {
      off();
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={t.kind === 'error' ? 'toast is-error' : 'toast'} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span>{t.message}</span>
          <button type="button" className="remove-x" aria-label="Dismiss" onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
