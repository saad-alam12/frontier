import { useEffect, useState } from 'react';
import type { DialogueView } from '../../backend/api/contract';
import { call, onEvent } from '../api';
import { plainError } from '../lib/errors';
import { AnswerSurface, Thinking } from '../components/AnswerSurface';
import { Breadcrumb, Screen } from '../components/Shell';
import { Button, Notice } from '../components/controls';
import { Markdown } from '../components/Markdown';
import { VerticalPath } from '../components/paths';

const TITLE = { oral: 'Oral exam', teach: 'Teach it back' } as const;
const WHO = { oral: 'Examiner', teach: 'Beginner' } as const;

/**
 * An oral exam or a teach-back (design §5.2, "Talking it through"): the examiner's questions or the
 * beginner's, the learner's answers under them, and at the end what each idea scored and why.
 */
export function DialogueScreen({ dialogueId, goalTitle, onBack, onBackToGoals }: { dialogueId: string; goalTitle: string; onBack: () => void; onBackToGoals: () => void }) {
  const [view, setView] = useState<DialogueView | null>(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState<'answer' | 'end' | null>(null);
  const [writing, setWriting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void call('dialogue.get', { dialogueId }).then(setView, (e: unknown) => setError(plainError(e instanceof Error ? e.message : String(e))));
    return onEvent('dialogue.writing', (e) => {
      if (e.dialogueId === dialogueId) setWriting(e.text);
    });
  }, [dialogueId]);

  const act = async (kind: 'answer' | 'end') => {
    if (!view || busy) return;
    const text = answer.trim();
    if (kind === 'answer' && !text) return;
    setBusy(kind);
    setError(null);
    setWriting(null);
    // the answer shows at once, above the question being written
    if (kind === 'answer') setView({ ...view, turns: [...view.turns, { who: 'learner', text }] });
    try {
      const next = kind === 'answer' ? await call('dialogue.answer', { dialogueId, answer: text }) : await call('dialogue.end', { dialogueId });
      setView(next);
      if (kind === 'answer') setAnswer('');
    } catch (e) {
      setView(view);
      setError(plainError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
      setWriting(null);
    }
  };

  if (!view) {
    return (
      <Screen>
        {error && (
          <>
            <Notice error>{error}</Notice>
            <div className="button-row">
              <Button onClick={onBack}>Back to the goal</Button>
            </div>
          </>
        )}
      </Screen>
    );
  }

  const title = TITLE[view.kind];
  const open = view.status === 'open';
  const scores = new Map(view.verdict?.ideas.map((i) => [i.nodeId, i]) ?? []);
  const aside = (
    <>
      <h2 className="t-title">What it is about</h2>
      <VerticalPath
        items={view.ideas.map((idea) => {
          const score = scores.get(idea.nodeId);
          return {
            key: idea.nodeId,
            state: score ? 'done' : open ? 'current' : 'upcoming',
            children: (
              <div className="flex flex-col gap-[2px]">
                <span>{idea.name}</span>
                {score && <span className="t-small text-muted">{score.score}/10</span>}
              </div>
            ),
          };
        })}
      />
      <div className="why-card">
        <div className="label">{view.kind === 'oral' ? 'How it works' : 'Why teach it'}</div>
        <div className="t-lead">
          {view.kind === 'oral'
            ? 'The examiner asks, then follows up on what you say: why it holds, what changes if a condition goes. Answer as you would in the room. At the end each idea gets a score, which counts like a practice answer.'
            : 'Explaining to someone new shows what you can say plainly and what you only recognise. The beginner asks what a beginner would. At the end each idea gets a score for how well you explained it.'}
        </div>
      </div>
    </>
  );

  return (
    <Screen aside={aside} asideLabel="What it is about">
      <div className="flex flex-col gap-[26px]">
        <Breadcrumb items={[{ label: 'Goals', onClick: onBackToGoals }, { label: goalTitle || view.goalTitle || 'Goal', onClick: onBack }, { label: title }]} />
        <div className="flex flex-col gap-[14px]">
          <h1 className="t-display">{title}</h1>
          <p className="t-lead m-0">
            {view.kind === 'oral' ? 'An examiner asks about ' : 'A beginner asks you to explain '}
            {view.ideas.length === 1 ? 'one idea' : `${view.ideas.length} ideas`} you have learned. Say it in your own words; there is nothing to look up.
          </p>
        </div>
      </div>

      <ol className="dialogue" aria-label="The conversation">
        {view.turns.map((turn, i) => (
          <li key={i} className={`dialogue-turn is-${turn.who}`}>
            <span className="t-caption text-muted">{turn.who === 'learner' ? 'You' : WHO[view.kind]}</span>
            {/* the question waiting for an answer uses the Question style, as in a session */}
            {turn.who === 'learner' ? <div className="answer-block learner-text whitespace-pre-wrap">{turn.text}</div> : <Markdown text={turn.text} className={open && !busy && i === view.turns.length - 1 ? 't-question' : 'text-[15px]'} />}
          </li>
        ))}
        {busy && writing && (
          <li className="dialogue-turn is-examiner writing-preview" aria-label="Being written">
            <span className="t-caption text-muted">{WHO[view.kind]}</span>
            <Markdown text={writing} className="t-question" />
          </li>
        )}
      </ol>
      {busy && !writing && <Thinking label={busy === 'end' ? 'Weighing what you said…' : 'Thinking…'} />}
      {error && <Notice error>{error}</Notice>}

      {open && !busy && (
        <div className="flex flex-col gap-[14px]">
          <AnswerSurface value={answer} onChange={setAnswer} onSubmit={() => void act('answer')} rows={5} placeholder="Say it or type it, as you would out loud." />
          <div className="button-row">
            <Button kind="primary" onClick={() => void act('answer')} disabled={!answer.trim()}>
              Send
            </Button>
            <span className="keyboard-hint">⌘↵ to send</span>
            <span className="button-row-end">
              <Button onClick={() => void act('end')}>{view.turns.some((t) => t.who === 'learner') ? 'End here' : 'Leave'}</Button>
            </span>
          </div>
          {view.answersLeft <= 2 && <p className="t-small m-0 text-muted">{view.answersLeft === 1 ? 'One more answer, then the verdict.' : 'Two more answers, then the verdict.'}</p>}
        </div>
      )}

      {!open && view.verdict && (
        <section className="dialogue-verdict" aria-label="How it went">
          <h2 className="t-title">How it went</h2>
          <Markdown text={view.verdict.summary} className="text-[16px] leading-[1.6]" />
          <ul className="flex flex-col gap-[14px] m-0 p-0 list-none">
            {view.verdict.ideas.map((idea) => (
              <li key={idea.nodeId} className="flex flex-col gap-[4px]">
                <span className="flex gap-[10px] items-baseline">
                  <strong>{view.ideas.find((i) => i.nodeId === idea.nodeId)?.name ?? idea.nodeId}</strong>
                  <span className="t-small text-muted">{idea.score}/10</span>
                </span>
                <Markdown text={idea.note} className="text-soft" />
              </li>
            ))}
          </ul>
        </section>
      )}
      {!open && (
        <div className="button-row">
          <Button kind="primary" onClick={onBack}>
            Back to the goal
          </Button>
        </div>
      )}
    </Screen>
  );
}
