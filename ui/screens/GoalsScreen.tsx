import { useCallback, useEffect, useState } from 'react';
import { call, onEvent } from '../api';
import type { GoalDetail } from '../../backend/api/contract';
import { Screen, type ScreenName } from '../components/Shell';
import { Button, Empty, MetaLine } from '../components/controls';
import { BudgetBar } from '../components/budget';
import { GoalFormScreen } from './goals/GoalForm';
import { GoalPage } from './goals/GoalPage';
import { GoalWizard } from './goals/GoalWizard';
import { ASSESSMENT_LABEL, formatDate, goalName } from './goals/labels';

export type GoalsView = { name: 'list' } | { name: 'new' } | { name: 'goal'; goalId: string } | { name: 'edit'; goalId: string } | { name: 'draft'; goalId: string };

export function GoalsScreen({
  onNavigate,
  onGoDeeper,
  onReviewCards,
  initial,
}: {
  onNavigate: (s: ScreenName) => void;
  onGoDeeper: (goalId: string, nodeIds?: string[]) => Promise<void>;
  /** Review one goal's flashcards on the Cards screen. */
  onReviewCards: (goalId: string) => void;
  initial?: GoalsView;
}) {
  const [goals, setGoals] = useState<GoalDetail[] | null>(null);
  const [view, setView] = useState<GoalsView>(initial ?? { name: 'list' });

  const refresh = useCallback(async () => setGoals(await call('goals.list')), []);
  useEffect(() => {
    void refresh();
    // background reading, profiling and compiling change what a goal shows
    const offGoals = onEvent('goals.changed', () => void refresh());
    const offLibrary = onEvent('library.progress', () => void refresh());
    return () => {
      offGoals();
      offLibrary();
    };
  }, [refresh]);

  if (goals === null) return <Screen>{null}</Screen>;
  const find = (goalId: string) => goals.find((g) => g.goal.id === goalId) ?? null;
  const open = (g: GoalDetail) => setView(g.goal.status === 'draft' ? { name: 'draft', goalId: g.goal.id } : { name: 'goal', goalId: g.goal.id });

  if (view.name === 'new' || view.name === 'draft') {
    return (
      <GoalWizard
        key={view.name === 'draft' ? view.goalId : 'new'}
        draft={view.name === 'draft' ? find(view.goalId) : null}
        onCancel={() => void refresh().then(() => setView({ name: 'list' }))}
        onDone={(goalId) => void refresh().then(() => setView({ name: 'goal', goalId }))}
      />
    );
  }

  if (view.name === 'edit') {
    const existing = find(view.goalId);
    if (existing) {
      return (
        <GoalFormScreen
          key={view.goalId}
          existing={existing}
          onCancel={() => setView({ name: 'goal', goalId: existing.goal.id })}
          onDone={(goalId) => void refresh().then(() => setView({ name: 'goal', goalId }))}
          onRemoved={() => void refresh().then(() => setView({ name: 'list' }))}
        />
      );
    }
  }

  if (view.name === 'goal') {
    const detail = find(view.goalId);
    if (detail) {
      return (
        <GoalPage
          key={detail.goal.id}
          detail={detail}
          onBack={() => setView({ name: 'list' })}
          onEdit={() => setView({ name: 'edit', goalId: detail.goal.id })}
          onChanged={() => void refresh()}
          onStartSession={async () => {
            await call('session.start', { goalId: detail.goal.id });
            onNavigate('session');
          }}
          onGoDeeper={(nodeIds) => onGoDeeper(detail.goal.id, nodeIds)}
          onReviewCards={() => onReviewCards(detail.goal.id)}
        />
      );
    }
  }

  return (
    <Screen>
      <div className="section-head items-end">
        <div className="flex flex-col gap-[10px]">
          <h1 className="t-display">Goals</h1>
          <p className="t-lead m-0">What you are learning toward. Each goal gets a plan that fits the time you give it.</p>
        </div>
        <Button kind="primary" onClick={() => setView({ name: 'new' })}>
          New goal
        </Button>
      </div>
      {goals.length === 0 ? (
        <Empty action={<Button onClick={() => setView({ name: 'new' })}>Set your first goal</Button>}>
          State what you want to learn: a course to pass, a book to work through, a paper to understand. Give it time, and Frontier plans the rest.
        </Empty>
      ) : (
        <ul className="goal-cards">
          {goals.map((g) => (
            <li key={g.goal.id}>
              <button type="button" className="goal-card" onClick={() => open(g)}>
                <span className="flex items-baseline justify-between gap-[16px]">
                  <span className="text-[17px] font-medium">{goalName(g)}</span>
                  <span className="t-small shrink-0 text-muted">{cardStatus(g)}</span>
                </span>
                <MetaLine
                  small
                  items={[
                    g.goal.kind === 'course' ? 'Course' : 'On your own',
                    g.goal.assessment !== 'none' ? ASSESSMENT_LABEL[g.goal.assessment] : null,
                    g.goal.date ? formatDate(g.goal.date) : null,
                    g.goal.status === 'paused' ? 'Paused' : null,
                  ]}
                />
                {g.progress && g.goal.status !== 'draft' && <BudgetBar compact caption progress={{ ...g.progress, plannedMinutes: g.progress.plan.plannedMinutes }} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

function cardStatus(g: GoalDetail): string {
  if (g.goal.status === 'draft') return g.capabilities.length ? 'Plan ready to approve' : 'Setting up';
  if (!g.capabilities.length) return g.work.state === 'idle' ? 'Not mapped yet' : 'Mapping…';
  const p = g.progress?.plan;
  return p ? `${p.ideas.ready} of ${p.ideas.total - p.ideas.cut} ideas ready` : '';
}
