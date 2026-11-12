import { useEffect, useState } from 'react';
import { call } from '../../api';
import type { ProbeAnswerInput, ProbeOutcome, ProbeView } from '../../../backend/api/contract';
import { useSurface } from '../../lib/activity';
import { Button, Section } from '../../components/controls';
import { ProbeFlow, ProbeResults } from '../../components/ProbeFlow';

/** "Check where you stand": a few questions that take what the learner already knows out of the plan. */
export function GoalCheck({ goalId, busy, run, onChanged }: { goalId: string; busy: string | null; run: (label: string, fn: () => Promise<void>) => Promise<void>; onChanged: () => void }) {
  const [probe, setProbe] = useState<ProbeView | null>(null);
  const [outcomes, setOutcomes] = useState<ProbeOutcome[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void call('probe.open', { goalId }).then((p) => !cancelled && setProbe(p));
    return () => {
      cancelled = true;
    };
  }, [goalId]);
  return (
    <Section title="Check where you stand" meta={probe ? 'Answers are kept until you submit' : undefined}>
      {probe ? (
        <ProbeSurface goalId={goalId}>
          <ProbeFlow
            probe={probe}
            busy={busy === 'probe-submit'}
            onSubmit={(answers: ProbeAnswerInput[]) =>
              void run('probe-submit', async () => {
                setOutcomes(await call('probe.submit', { probeId: probe.id, answers }));
                setProbe(null);
                onChanged();
              })
            }
            onStop={() => void call('probe.cancel', { probeId: probe.id })}
          />
        </ProbeSurface>
      ) : outcomes ? (
        <ProbeResults outcomes={outcomes} />
      ) : (
        <>
          <p className="m-0 text-secondary">A few quick questions. What you already know drops out of the plan, so your time goes to what is new. Guessing is fine.</p>
          <div className="button-row">
            <Button onClick={() => void run('probe', async () => setProbe(await call('probe.create', { goalId })))} disabled={busy !== null}>
              {busy === 'probe' ? 'Writing questions…' : 'Ask me a few questions'}
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}

/** Time spent answering the probe counts toward the goal. */
function ProbeSurface({ goalId, children }: { goalId: string; children: React.ReactNode }) {
  useSurface('probe', { goalId });
  return <>{children}</>;
}
