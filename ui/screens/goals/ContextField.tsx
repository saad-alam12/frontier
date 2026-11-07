import { useLayoutEffect, useRef, useState } from 'react';
import { CONTEXT_MAX_CHARS } from '../../../backend/core/types';

/** The count shows only near the limit, so the field stays quiet while there is room. */
const COUNT_FROM = CONTEXT_MAX_CHARS - 500;

/** The goal's context: anything that shapes it, in the learner's words, on as many lines as it takes. */
export function ContextField({ value, onChange, note }: { value: string; onChange: (next: string) => void; note?: string | null }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor="goal-context">
        Anything the plan should know?
      </label>
      <textarea
        id="goal-context"
        className="input context-input"
        rows={3}
        maxLength={CONTEXT_MAX_CHARS}
        value={value}
        placeholder="Why you want it, what it is for, limits, what to focus on or skip"
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="field-hint context-hint">
        <span>{note ?? 'Optional. The map is drawn around it, and sessions use it for their examples.'}</span>
        {value.length > COUNT_FROM && (
          <span className="shrink-0 tabular-nums">
            {value.length.toLocaleString('en-GB')} of {CONTEXT_MAX_CHARS.toLocaleString('en-GB')}
          </span>
        )}
      </div>
    </div>
  );
}

/** The context on the goal page: two lines, with More when there is more. */
export function ContextNote({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setClipped(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);
  return (
    <div className="goal-context">
      <p ref={ref} className={open ? 'm-0' : 'm-0 is-clamped'}>
        {text}
      </p>
      {(clipped || open) && (
        <button type="button" className="link-button self-start" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Less' : 'More'}
        </button>
      )}
    </div>
  );
}
