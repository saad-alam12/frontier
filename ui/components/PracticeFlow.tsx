import type { PracticeProblemView, PracticeView } from '../../backend/api/contract';
import { confidenceLabel } from '../../backend/core/types';
import type { CodeAnswer as CodeAnswerValue } from '../../backend/api/contract';
import { AnswerActions, AnswerSurface } from './AnswerSurface';
import { CodeAnswer, SentCode, codeOf } from './CodeAnswer';
import type { CodeDraft } from './CodeAnswer';
import { Button } from './controls';
import { Markdown } from './Markdown';
import { useDrafts } from '../hooks/useDrafts';

type Draft = { answer: string; confidence: number | null; code?: CodeDraft | null };
const EMPTY: Draft = { answer: '', confidence: null, code: null };

/** An answer to a practice problem as the screens send it. */
export type PracticeSubmit = (problemId: string, answer: string, confidence: number | null, code?: CodeAnswerValue) => void;

const RUNG_LABEL = ['Worked example', 'Finish the solution', 'Exercise', 'Several ideas at once', 'Find the way in'];

/**
 * A practice set as a conversation: each answered problem stays on the page with the learner's
 * answer, the solution (shown at once) and the grade (when it lands); the next problem sits below.
 * One attempt per problem; the ideas a problem drew on are named only after answering.
 */
export function PracticeFlow({
  view,
  revealedId,
  busy,
  onSubmit,
  onNext,
}: {
  view: PracticeView;
  /** The problem whose solution was just revealed; "Next" moves on. */
  revealedId: string | null;
  busy: boolean;
  onSubmit: PracticeSubmit;
  onNext: () => void;
}) {
  const answered = view.problems.filter((p) => p.answer !== null);
  const current = view.currentIndex === null || revealedId ? null : (view.problems[view.currentIndex] ?? null);
  const total = view.problems.length;
  const isLast = view.currentIndex === null;
  return (
    <div className="flex flex-col gap-[48px]">
      {answered.map((p) => (
        <AnsweredProblem key={p.id} problem={p} index={view.problems.indexOf(p)} total={total} />
      ))}
      {revealedId && (
        <div className="button-row">
          <Button kind="primary" onClick={onNext} disabled={busy}>
            {isLast ? 'Done with practice' : 'Next problem'}
          </Button>
        </div>
      )}
      {current && <OpenProblem key={current.id} problem={current} index={view.currentIndex ?? 0} total={total} busy={busy} onSubmit={onSubmit} />}
    </div>
  );
}

function ProblemHead({ problem, index, total }: { problem: PracticeProblemView; index: number; total: number }) {
  return (
    <div className="t-caption text-muted">
      Problem {index + 1} of {total} · {RUNG_LABEL[problem.rung] ?? 'Exercise'}
      {problem.presentation === 'application' ? ' · in a real setting' : ''}
    </div>
  );
}

function OpenProblem({ problem, index, total, busy, onSubmit }: { problem: PracticeProblemView; index: number; total: number; busy: boolean; onSubmit: PracticeSubmit }) {
  const key = `practice:${problem.id}`;
  const drafts = useDrafts<Draft>([key], EMPTY);
  const draft = drafts.values[key] ?? EMPTY;
  /** "No idea" sends nothing else; an answer goes with its code and the code's last run. */
  const send = (answer: string, noIdea = false) => {
    if (busy) return;
    drafts.set(key, EMPTY);
    onSubmit(problem.id, answer, draft.confidence, noIdea ? undefined : codeOf(draft.code));
  };
  return (
    <section className="flex flex-col gap-[32px]">
      <div className="flex flex-col gap-[14px]">
        <ProblemHead problem={problem} index={index} total={total} />
        <Markdown text={problem.statement} className="t-question" />
      </div>
      <AnswerSurface
        value={draft.answer}
        onChange={(answer) => drafts.set(key, { ...draft, answer })}
        onSubmit={() => send(draft.answer)}
        confidence={draft.confidence}
        onConfidence={(confidence) => drafts.set(key, { ...draft, confidence })}
        rows={5}
        disabled={busy}
      />
      <CodeAnswer draft={draft.code ?? null} onChange={(code) => drafts.set(key, { ...draft, code })} starter={problem.code?.starter} disabled={busy} onSubmit={() => send(draft.answer)} />
      <div className="flex flex-col gap-[10px]">
        <AnswerActions onSubmit={() => send(draft.answer)} onNoIdea={() => send('', true)} disabled={busy} />
        <p className="t-small m-0 text-muted">One attempt. The solution appears as soon as you submit.</p>
      </div>
    </section>
  );
}

function AnsweredProblem({ problem, index, total }: { problem: PracticeProblemView; index: number; total: number }) {
  const answer = problem.answer;
  return (
    <article className="flex flex-col gap-[16px]" id={`problem-${problem.id}`}>
      <ProblemHead problem={problem} index={index} total={total} />
      <Markdown text={problem.statement} className="text-[15px]" />
      {answer && (
        <div className="answer-block flex flex-col gap-[8px]">
          {answer.text.trim() ? <div className="learner-text whitespace-pre-wrap">{answer.text}</div> : answer.code ? null : <div className="learner-text text-muted">No idea</div>}
          {answer.code && <SentCode code={answer.code} />}
          {answer.confidence !== null && <div className="t-caption text-muted">{capitalize(confidenceLabel(answer.confidence))}</div>}
        </div>
      )}
      {problem.solution && (
        <div className="solution-block flex flex-col gap-[8px]">
          <div className="t-caption text-muted">Solution</div>
          <Markdown text={problem.solution} className="markdown text-[15px] text-soft" />
        </div>
      )}
      {problem.grade ? (
        <div className="flex flex-col gap-[6px]">
          <span className="font-medium">{formatScore(problem.grade.score)}/10</span>
          <Markdown text={problem.grade.feedback} className="text-soft" />
        </div>
      ) : (
        <p className="t-small m-0 text-muted" aria-live="polite">
          Grading…
        </p>
      )}
      {problem.ideas && problem.ideas.length > 0 && (
        <div className="idea-chips" aria-label="Ideas this drew on">
          <span className="t-caption text-muted">Drew on</span>
          {problem.ideas.map((i) => (
            <span key={i.nodeId} className="idea-chip">
              <Markdown text={i.name} inline />
              {i.score !== null && <span className="text-muted">{formatScore(i.score)}</span>}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
