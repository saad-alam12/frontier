import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '../api';

const SAVE_DELAY_MS = 400;

/**
 * Unsent answers that survive leaving the screen and quitting the app. Values load from the backend
 * when the keys change and are saved debounced; an empty value deletes the draft. `empty` must be a
 * module-level constant so its identity is stable.
 */
export function useDrafts<T>(keys: string[], empty: T): { values: Record<string, T>; ready: boolean; set: (key: string, value: T) => void } {
  const [values, setValues] = useState<Record<string, T>>({});
  const [ready, setReady] = useState(false);
  const timers = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; save: () => void }>());
  const keyList = keys.join('\n');

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    const list = keyList ? keyList.split('\n') : [];
    void call('drafts.get', { keys: list }).then((stored) => {
      if (cancelled) return;
      const parsed: Record<string, T> = {};
      for (const [key, raw] of Object.entries(stored)) {
        try {
          parsed[key] = { ...empty, ...(JSON.parse(raw) as T) };
        } catch {
          // a draft that does not parse is dropped
        }
      }
      setValues(parsed);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [keyList, empty]);

  // Leaving the screen saves what is still waiting for its debounce.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const { timer, save } of pending.values()) {
        clearTimeout(timer);
        save();
      }
      pending.clear();
    };
  }, []);

  const set = useCallback(
    (key: string, value: T) => {
      setValues((prev) => ({ ...prev, [key]: value }));
      const existing = timers.current.get(key);
      if (existing) clearTimeout(existing.timer);
      const save = () => {
        timers.current.delete(key);
        const isEmpty = JSON.stringify(value) === JSON.stringify(empty);
        void call('drafts.set', { key, value: isEmpty ? '' : JSON.stringify(value) });
      };
      timers.current.set(key, { timer: setTimeout(save, SAVE_DELAY_MS), save });
    },
    [empty],
  );

  return { values, ready, set };
}
