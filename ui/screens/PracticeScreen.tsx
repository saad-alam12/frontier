import { plainError } from '../lib/errors';
import { useCallback, useEffect, useState } from 'react';
import type { CodeAnswer, PracticeView } from '../../backend/api/contract';
import { call, onEvent } from '../api';
import { Breadcrumb, Screen } from '../components/Shell';
import { Button, Notice } from '../components/controls';
import { Markdown } from '../components/Markdown';
import { PracticeFlow } from '../components/PracticeFlow';
import { VerticalPath } from '../components/paths';

/** A compound practice set or mock exam, opened from Today. */
export function PracticeScreen({ setId, onBack }: { setId: string; onBack: () => void }) {
  const [view, setView] = useState<PracticeView | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setView(await call('practice.get', { setId }));
    } catch (e) {
      setError(plainError(e instanceof Error ? e.message : String(e)));
    }
  }, [setId]);
  useEffect(() => {
    void refresh();
    return onEvent('practice.graded', (e) => {
      if (e.setId === setId) void refresh();
    });
  }, [refresh, setId]);

  const submit = async (problemId: string, answer: string, confidence: number | null, code?: CodeAnswer) => {
    setBusy(true);
    setError(null);
    try {
      setView(await call('practice.submit', { problemId, answer, confidence, ...(code ? { code } : {}) }));
      setRevealed(problemId);
    } catch (e) {
      setError(plainError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  /** Leave the set as it stands and go back; nothing is recorded for the problems not answered. */
  const stop = async () => {
    setBusy(true);
    setError(null);
    try {
      await call('practice.end', { setId });
      onBack();
    } catch (e) {
      setError(plainError(e instanceof Error ? e.message : String(e)));
      setBusy(false);
    }
  };

  if (!view) {
    return (
      <Screen>
        {error && (
          <>
            <Notice error>{error}</Notice>
            <div className="button-row">
              <Button onClick={onBack}>Back to today</Button>
            </div>
          </>
        )}
      </Screen>
    );
  }
  const mock = view.kind === 'mock';
  const finished = view.currentIndex === null && revealed === null;
  const graded = view.problems.filter((p) => p.grade !== null);
  const mean = graded.length ? graded.reduce((s, p) => s + (p.grade?.score ?? 0), 0) / graded.length : null;

  const aside = (
    <>
      <h2 className="t-title">{mock ? 'Mock exam' : 'This set'}</h2>
      <VerticalPath
        items={view.problems.map((p, i) => ({
          key: p.id,
          state: p.answer ? 'done' : i === view.currentIndex && !revealed ? 'current' : 'upcoming',
          children: (
            <div className="flex flex-col gap-[2px]">
              <span className={p.answer ? '' : 'text-secondary'}>Problem {i + 1}</span>
              <span className="t-small text-muted">{p.grade ? `${p.grade.score}/10` : p.answer ? 'Grading…' : 'Not answered yet'}</span>
            </div>
          ),
        }))}
      />
      <div className="why-card">
        <div className="label">{mock ? 'How a mock works' : 'Why these problems'}</div>
        <div className="t-lead">
          {mock
            ? 'Each problem is written the way your exam asks. Answer without notes; the solution comes right after.'
            : 'Each problem needs several ideas that are starting to fade. Working them out together refreshes all of them and links them.'}
        </div>
      </div>
    </>
  );

  return (
    <Screen aside={aside} asideLabel={mock ? 'Mock exam' : 'This set'}>
      <div className="flex flex-col gap-[26px]">
        <Breadcrumb items={[{ label: 'Today', onClick: onBack }, { label: view.goalTitle || 'Practice' }, { label: mock ? 'Mock exam' : 'Practice' }]} />
        <div className="flex flex-col gap-[14px]">
          <h1 className="t-display">{mock ? 'Mock exam' : 'Practice'}</h1>
          <p className="t-lead m-0">
            {view.problems.length} {view.problems.length === 1 ? 'problem' : 'problems'}. The problems never say which idea they need; finding it is part of the work.
          </p>
        </div>
      </div>
      {error && <Notice error>{error}</Notice>}
      <PracticeFlow view={view} revealedId={revealed} busy={busy} onSubmit={(id, a, c, code) => void submit(id, a, c, code)} onNext={() => setRevealed(null)} />
      {!finished && (
        <div className="button-row border-t border-line pt-[18px]">
          <Button kind="quiet" disabled={busy} onClick={() => void stop()}>
            Stop here
          </Button>
          <span className="t-small text-muted">What you answered counts. The problems you leave count for nothing.</span>
        </div>
      )}
      {finished && (
        <section className="flex flex-col gap-[18px] border-t border-line pt-[28px]">
          <h2 className="t-heading m-0">{mean === null ? 'All answered' : `Done: ${mean.toFixed(1)} out of 10 on average`}</h2>
          <p className="m-0 text-soft">
            {graded.length < view.problems.length ? 'Grades are still arriving; they count as soon as they land.' : 'Every idea in these problems has been reviewed, and the ideas they are built on got partial credit.'}
          </p>
          {view.problems.some((p) => p.ideas?.length) && (
            <p className="t-small m-0 text-muted">
              Reviewed: <Markdown inline text={[...new Set(view.problems.flatMap((p) => (p.ideas ?? []).map((i) => i.name)))].join(', ')} />
            </p>
          )}
          <div className="button-row">
            <Button kind="primary" onClick={onBack}>
              Back to today
            </Button>
          </div>
        </section>
      )}
    </Screen>
  );
}
