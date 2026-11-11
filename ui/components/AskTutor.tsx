import { useState } from 'react';
import type { Aside, AsideMode } from '../../backend/api/contract';
import { Button } from './controls';
import { Markdown } from './Markdown';
import { submitOnModEnter } from './AnswerSurface';

/** What a learner can ask for besides a question of their own, on a card that explains. */
const ANOTHER_FORM: { mode: 'different' | 'simpler' | 'example'; label: string }[] = [
  { mode: 'different', label: 'Explain it differently' },
  { mode: 'simpler', label: 'Simpler' },
  { mode: 'example', label: 'Show an example' },
];
const ASKED: Record<'different' | 'simpler' | 'example', string> = { different: 'Explained differently', simpler: 'Simpler', example: 'An example' };
const QUESTION_MAX = 2000;

/**
 * Ask the tutor about the card that is open: a question in the learner's own words, and on a card
 * that explains, the explanation in another form. The answer is not graded and the card stays.
 */
export function AskTutor({
  explains,
  hints,
  busy,
  onAsk,
}: {
  explains: boolean;
  /** On a question that takes hints: how many were taken and how many are left. */
  hints?: { taken: number; left: number };
  busy: boolean;
  onAsk: (mode: AsideMode, question?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const ask = () => {
    const question = text.trim();
    if (!question || busy) return;
    onAsk('question', question);
    setText('');
    setOpen(false);
  };
  if (open)
    return (
      <div className="flex flex-col gap-[12px]">
        <textarea
          className="input ask-input"
          rows={2}
          autoFocus
          maxLength={QUESTION_MAX}
          aria-label="Your question for the tutor"
          placeholder="Ask about this step. It is not graded."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
              return;
            }
            submitOnModEnter(e, ask);
          }}
        />
        <div className="button-row">
          <Button onClick={ask} disabled={busy || !text.trim()}>
            Ask
          </Button>
          <Button kind="quiet" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <span className="keyboard-hint">⌘↵ to ask</span>
        </div>
      </div>
    );
  return (
    <div className="chip-group" aria-label="Ask the tutor">
      {explains &&
        ANOTHER_FORM.map((form) => (
          <button key={form.mode} type="button" className="chip is-quiet" disabled={busy} onClick={() => onAsk(form.mode)}>
            {form.label}
          </button>
        ))}
      {hints && hints.left > 0 && (
        <button type="button" className="chip is-quiet" disabled={busy} title="A hint moves you one step. An answer given with hints counts for less than one given without." onClick={() => onAsk('hint')}>
          {hints.taken ? 'Another hint' : 'Give me a hint'}
        </button>
      )}
      <button type="button" className="chip is-quiet" disabled={busy} onClick={() => setOpen(true)}>
        Ask a question
      </button>
    </div>
  );
}

/** What the learner asked about a card and what the tutor said, under that card. */
export function Asides({ asides, past }: { asides: Aside[]; past?: boolean }) {
  if (!asides.length) return null;
  return (
    <div className="asides">
      {asides.map((aside, i) => (
        <div key={aside.id} className="aside">
          <div className="t-caption text-muted">
            {aside.mode === 'question' ? 'You asked' : aside.mode === 'hint' ? `Hint ${asides.slice(0, i + 1).filter((a) => a.mode === 'hint').length}` : ASKED[aside.mode]}
          </div>
          {aside.mode === 'question' && <div className="aside-question whitespace-pre-wrap">{aside.question}</div>}
          <Markdown text={aside.answer} className={past ? 'text-[15px] text-soft' : 'text-[16px] leading-[1.6] text-soft'} />
        </div>
      ))}
    </div>
  );
}
