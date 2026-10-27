import { useCallback, useEffect, useState } from 'react';
import { call, onEvent } from '../api';
import type { GoalDetail } from '../../backend/api/contract';
import { Screen, type ScreenName } from '../components/Shell';
import { Button, Empty, MetaLine } from '../components/controls';
import { GoalFormScreen } from './goals/GoalForm';
import { GoalPage } from './goals/GoalPage';
import { ASSESSMENT_LABEL, SKILL_LABEL, formatDate, goalName } from './goals/labels';

type View = { name: 'list' } | { name: 'new' } | { name: 'goal'; goalId: string } | { name: 'edit'; goalId: string };

export function GoalsScreen({ onNavigate }: { onNavigate: (s: ScreenName) => void }) {
  const [goals, setGoals] = useState<GoalDetail[] | null>(null);
  const [view, setView] = useState<View>({ name: 'list' });

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

  if (view.name === 'new' || view.name === 'edit') {
    const existing = view.name === 'edit' ? find(view.goalId) : null;
    return (
      <GoalFormScreen
        key={view.name === 'edit' ? view.goalId : 'new'}
        existing={existing}
        onCancel={() => setView(existing ? { name: 'goal', goalId: existing.goal.id } : { name: 'list' })}
        onDone={(goalId) => void refresh().then(() => setView({ name: 'goal', goalId }))}
        onRemoved={() => void refresh().then(() => setView({ name: 'list' }))}
      />
    );
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
        />
      );
    }
  }

  return (
    <Screen>
      <div className="section-head">
        <h1 className="t-display">Goals</h1>
        <Button kind="primary" onClick={() => setView({ name: 'new' })}>
          New goal
        </Button>
      </div>
      {goals.length === 0 ? (
        <Empty>State what you want to be able to do: a course to pass, a project to finish, something to understand. Frontier works out the rest.</Empty>
      ) : (
        <ul className="list-card">
          {goals.map((g) => {
            const ready = g.capabilities.filter((c) => c.status === 'ready').length;
            return (
              <li key={g.goal.id}>
                <button type="button" className="row items-center" onClick={() => setView({ name: 'goal', goalId: g.goal.id })}>
                  <span className="flex min-w-0 flex-col gap-[2px]">
                    <span className="text-[15px]">{goalName(g)}</span>
                    <MetaLine
                      small
                      items={[
                        g.goal.kind === 'course' ? 'Course' : 'On your own',
                        g.goal.assessment !== 'none' ? ASSESSMENT_LABEL[g.goal.assessment] : null,
                        g.goal.date ? formatDate(g.goal.date) : null,
                      ]}
                    />
                  </span>
                  <span className="t-small shrink-0 text-muted">
                    {g.capabilities.length ? `${ready} of ${g.capabilities.length} skills ${SKILL_LABEL.ready.toLowerCase()}` : g.work.state === 'idle' ? 'Not mapped yet' : 'Mapping…'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Screen>
  );
}
