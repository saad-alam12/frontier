import { useEffect, useId, useState } from 'react';
import { call } from '../api';
import type { GoalCardSettings } from '../../backend/api/contract';
import { DEFAULT_GOAL_CARDS } from '../../backend/core/cards';
import { Section } from './controls';
import './Cards.css';

/** An on/off setting, drawn as a switch (the accent marks "on"). */
export function Switch({ on, onChange, label, id, disabled }: { on: boolean; onChange: (on: boolean) => void; label?: string; id?: string; disabled?: boolean }) {
  return <button type="button" role="switch" id={id} aria-checked={on} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!on)} />;
}

/** Loads a goal's card settings (the defaults for a goal not saved yet) and how many automatic cards it has. */
export function useGoalCardSettings(goalId: string | null): [GoalCardSettings, (v: GoalCardSettings) => void, number] {
  const [value, setValue] = useState<GoalCardSettings>({ ...DEFAULT_GOAL_CARDS });
  const [made, setMade] = useState(0);
  useEffect(() => {
    if (!goalId) return;
    let live = true;
    void call('cards.goalSettings', { goalId }).then((s) => {
      if (!live) return;
      setValue({ enabled: s.enabled, max: s.max });
      setMade(s.auto);
    });
    return () => {
      live = false;
    };
  }, [goalId]);
  return [value, setValue, made];
}

export function saveCardSettings(goalId: string, value: GoalCardSettings) {
  return call('cards.saveGoalSettings', { goalId, settings: { enabled: value.enabled, max: Math.max(1, Math.min(500, Math.round(value.max) || DEFAULT_GOAL_CARDS.max)) } });
}

/** "Make flashcards for me" and "At most N cards", for the new-goal flow and Edit goal. */
export function GoalCardSettingsField({ value, onChange, made }: { value: GoalCardSettings; onChange: (v: GoalCardSettings) => void; made?: number }) {
  const switchId = useId();
  const maxId = useId();
  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-col gap-[2px]">
        <div className="text-[15px] text-text">Flashcards</div>
        <div className="t-small text-muted">For the facts to know by heart (formulas, definitions, names, numbers), written after each idea you learn.</div>
      </div>
      <div className="switch-row">
        <label className="switch-label" htmlFor={switchId}>
          <Switch id={switchId} on={value.enabled} onChange={(enabled) => onChange({ ...value, enabled })} />
          Make flashcards for me
        </label>
        {value.enabled && (
          <span className="card-max">
            <label htmlFor={maxId}>At most</label>
            <input id={maxId} className="input" type="number" min={1} max={500} step={5} value={value.max} onChange={(e) => onChange({ ...value, max: Number(e.target.value) })} />
            <span>cards</span>
          </span>
        )}
      </div>
      {value.enabled && made !== undefined && made > 0 && (
        <div className="t-small text-muted">
          {made} made so far{made >= value.max ? '; no more are written until you raise the limit' : ''}.
        </div>
      )}
    </div>
  );
}

/** Settings: whether sessions that serve no goal make flashcards too. */
export function FlashcardPreferences() {
  const [withoutGoal, setWithoutGoal] = useState<boolean | null>(null);
  const id = useId();
  useEffect(() => {
    void call('cards.preferences').then((p) => setWithoutGoal(p.withoutGoal));
  }, []);
  if (withoutGoal === null) return null;
  return (
    <Section title="Flashcards" gap={14}>
      <div className="settings-group">
        <div className="settings-row">
          <div className="flex min-w-0 flex-col gap-[2px]">
            <label className="settings-label" htmlFor={id}>
              Sessions without a goal
            </label>
            <span className="t-small text-muted">Make cards for the hard facts of ideas you learn on your own. Each goal has its own setting in Edit goal.</span>
          </div>
          <div className="settings-control">
            <Switch id={id} on={withoutGoal} onChange={(on) => void call('cards.savePreferences', { withoutGoal: on }).then((p) => setWithoutGoal(p.withoutGoal))} />
          </div>
        </div>
      </div>
    </Section>
  );
}
