import { useEffect, useState } from 'react';
import { CONFIDENCE_LEVELS } from '../../backend/core/types';
import { Button } from './Page';

export const ANSWER_PLACEHOLDER = 'Say it or type it, however it comes. Leave it empty if you have no idea.';
const HINT = 'Speak or type, however it comes';
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
}) {
  const [listening, noteInput] = useListening();
  return (
    <div className="answer-surface">
      <textarea
        aria-label={label}
        className="answer-input learner-text"
        rows={rows}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          noteInput(e.target.value.length - value.length);
          onChange(e.target.value);
        }}
        onKeyDown={(e) => submitOnModEnter(e, onSubmit)}
      />
      <div className="answer-footer">
        <div className="answer-hint">
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
          ) : (
            <span>{HINT}</span>
          )}
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

/** Submit, "No idea" (submits empty) and the keyboard hint, under every answer field. */
export function AnswerActions({ onSubmit, onNoIdea, submitLabel = 'Submit', disabled }: { onSubmit: () => void; onNoIdea: () => void; submitLabel?: string; disabled?: boolean }) {
  return (
    <div className="answer-actions">
      <Button kind="primary" onClick={onSubmit} disabled={disabled}>
        {submitLabel}
      </Button>
      <Button onClick={onNoIdea} disabled={disabled}>
        I have no idea
      </Button>
      <span className="keyboard-hint">⌘↵ to submit</span>
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
