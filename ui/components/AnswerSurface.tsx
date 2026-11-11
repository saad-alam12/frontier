import { useEffect, useRef, useState } from 'react';
import { CONFIDENCE_LEVELS } from '../../backend/core/types';
import { Button } from './controls';
import { AttachButton, PendingExtras, attachHandlers, clearQuote, useAnswerExtras, useExtrasTarget } from './AnswerExtras';

export const ANSWER_PLACEHOLDER = 'Say it or type it, however it comes. Leave it empty if you have no idea.';
/** Text that arrives several characters at once (dictation tools paste or type in bursts). */
const BURST_CHARS = 4;
const LISTENING_MS = 1500;

/**
 * The one answer field: answer and reasoning mixed, or empty for "no idea". A plain textarea, so text
 * typed or pasted in by a dictation app works like any other input. ⌘↵ (Ctrl+Enter) submits.
 */
export function AnswerSurface({
  value,
  onChange,
  onSubmit,
  confidence,
  onConfidence,
  placeholder = ANSWER_PLACEHOLDER,
  rows = 4,
  disabled,
  label = 'Your answer',
  autoFocus,
  extras,
}: {
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  /** Omit both to hide the confidence choices. */
  confidence?: number | null;
  onConfidence?: (value: number | null) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  label?: string;
  /** Focus the field on mount, as after stopping a judged answer to edit it. */
  autoFocus?: boolean;
  /** Accept attached images (paste, drop, paperclip) and a quoted reply, as session answers do. */
  extras?: boolean;
}) {
  const [listening, noteInput] = useListening();
  const { quote, quoteVersion } = useAnswerExtras();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useExtrasTarget(Boolean(extras));
  // a new quote means the learner is about to reply to it
  useEffect(() => {
    if (extras && quoteVersion > 0) inputRef.current?.focus();
  }, [extras, quoteVersion]);
  return (
    <div className="answer-surface" {...(extras ? attachHandlers(disabled) : {})}>
      {extras && <PendingExtras disabled={disabled} />}
      <textarea
        ref={inputRef}
        aria-label={label}
        className="answer-input learner-text"
        rows={rows}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => {
          noteInput(e.target.value.length - value.length);
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          // Esc drops a pending quote; with none it is left alone for whatever else listens
          if (extras && e.key === 'Escape' && quote) {
            e.preventDefault();
            e.stopPropagation();
            clearQuote();
            return;
          }
          submitOnModEnter(e, onSubmit);
        }}
      />
      <div className="answer-footer">
        <div className="answer-hint">
          {extras && <AttachButton disabled={disabled} />}
          {listening ? (
            <>
              <span className="listening-bars" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
              </span>
              <span>Listening</span>
            </>
          ) : null}
        </div>
        {onConfidence && (
          <div role="radiogroup" aria-label="How sure are you" className="confidence-chips">
            {CONFIDENCE_LEVELS.map((level) => {
              const selected = confidence === level.value;
              return (
                <button
                  key={level.label}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={selected ? 'confidence-chip is-selected' : 'confidence-chip'}
                  disabled={disabled}
                  onClick={() => onConfidence(selected ? null : level.value)}
                >
                  {level.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Submit, "No idea" (submits empty), "test me" where offered, and the keyboard hint, under every answer field. */
export function AnswerActions({
  onSubmit,
  onNoIdea,
  onTestMe,
  submitLabel = 'Submit',
  disabled,
}: {
  onSubmit: () => void;
  onNoIdea: () => void;
  /** "I know this, test me": skip to the question that shows the idea is yours. */
  onTestMe?: () => void;
  submitLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div className="answer-actions">
      <Button kind="primary" onClick={onSubmit} disabled={disabled}>
        {submitLabel}
      </Button>
      <Button onClick={onNoIdea} disabled={disabled}>
        I have no idea
      </Button>
      {onTestMe && (
        <Button kind="quiet" onClick={onTestMe} disabled={disabled}>
          I know this, test me
        </Button>
      )}
      <span className="keyboard-hint">⌘↵ to submit</span>
    </div>
  );
}

/** While an answer is being judged: Esc (or Stop) stops the model and gives the answer back to edit. */
export function Thinking({ label = 'Thinking…', onStop }: { label?: string; onStop?: () => void }) {
  return (
    <div className="thinking-row">
      <span className="t-small text-muted">{label}</span>
      {onStop && (
        <>
          <Button kind="quiet" onClick={onStop}>
            Stop
          </Button>
          <span className="keyboard-hint">Esc to stop and edit</span>
        </>
      )}
    </div>
  );
}

/** ⌘↵ or Ctrl+Enter submits, everywhere an answer is given. */
export function submitOnModEnter(e: React.KeyboardEvent, onSubmit: () => void): void {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    onSubmit();
  }
}

/** True for a moment after input arrives in a burst, as dictation apps deliver it. */
function useListening(): [boolean, (grewBy: number) => void] {
  const [burstAt, setBurstAt] = useState<number | null>(null);
  useEffect(() => {
    if (burstAt === null) return;
    const timer = setTimeout(() => setBurstAt(null), LISTENING_MS);
    return () => clearTimeout(timer);
  }, [burstAt]);
  return [burstAt !== null, (grewBy) => grewBy >= BURST_CHARS && setBurstAt(Date.now())];
}
