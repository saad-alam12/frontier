import { useState } from 'react';
import type { ProbeOutcome, ProbeView } from '../../backend/api/contract';
import { AnswerSurface } from './AnswerSurface';
import { Button } from './controls';
import { Markdown } from './Markdown';
import { useDrafts } from '../hooks/useDrafts';

export type ProbeDraft = { answer: string; confidence: number | null };
const EMPTY: ProbeDraft = { answer: '', confidence: null };

export const probeDraftKey = (problemId: string) => `probe:${problemId}`;

/** The probe, one question at a time with back and next. Answers are drafts until the last question is submitted. */
export function ProbeFlow({ probe, busy, onSubmit }: { probe: ProbeView; busy: boolean; onSubmit: (answers: { problemId: string; answer: string; confidence: number | null }[]) => void }) {
  const drafts = useDrafts<ProbeDraft>(probe.questions.map((q) => probeDraftKey(q.problemId)), EMPTY);
  const [index, setIndex] = useState(0);
  const question = probe.questions[index];
  if (!question) return null;
  const key = probeDraftKey(question.problemId);
  const draft = drafts.values[key] ?? EMPTY;
  const last = index === probe.questions.length - 1;
  const submitAll = () => {
    if (busy) return;
    onSubmit(probe.questions.map((q) => ({ problemId: q.problemId, ...(drafts.values[probeDraftKey(q.problemId)] ?? EMPTY) })));
  };
  const next = () => (last ? submitAll() : setIndex(index + 1));

  return (
    <section className="flex flex-col gap-[32px]" aria-label="Probe">
      <div className="flex flex-col gap-[18px]">
        <div className="t-caption text-muted">
          Question {index + 1} of {probe.questions.length}
        </div>
        <Markdown text={question.question} className="t-question" />
      </div>
      <AnswerSurface
        key={question.problemId}
        value={draft.answer}
        onChange={(answer) => drafts.set(key, { ...draft, answer })}
        onSubmit={next}
        confidence={draft.confidence}
        onConfidence={(confidence) => drafts.set(key, { ...draft, confidence })}
        disabled={busy}
      />
      <div className="answer-actions">
        <Button kind="primary" onClick={next} disabled={busy}>
          {last ? (busy ? 'Judging…' : 'Submit answers') : 'Next'}
        </Button>
        {index > 0 && (
          <Button onClick={() => setIndex(index - 1)} disabled={busy}>
            Back
          </Button>
        )}
        <span className="keyboard-hint">{last ? '⌘↵ to submit' : '⌘↵ for the next question'}. Empty means no idea.</span>
      </div>
    </section>
  );
}

/** Per question: the score, the one-line rationale and any misconception noted. */
export function ProbeResults({ outcomes }: { outcomes: ProbeOutcome[] }) {
  return (
    <ul className="list-card">
      {outcomes.map((o) => (
        <li key={o.nodeId} className="flex flex-col gap-[4px]">
          <span className="row">
            <Markdown text={o.nodeName} inline className="font-medium" />
            <span className="shrink-0">{Math.round(o.score * 10)}/10</span>
          </span>
          <Markdown text={o.reasoning} className="text-soft" />
          {o.misconception && <span className="t-small text-secondary">Noted to repair: {o.misconception}</span>}
          {o.impliedPremises.length > 0 && <span className="t-small text-muted">Also credits: {o.impliedPremises.map((p) => p.nodeName).join(', ')}</span>}
        </li>
      ))}
    </ul>
  );
}
