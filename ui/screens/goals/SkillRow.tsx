/** One skill of a goal, with its ideas and how deep each is taught. */
import { useState } from 'react';
import type { GoalDetail, PracticeLevel } from '../../../backend/api/contract';
import { MAX_FREE_IDEAS } from '../../../backend/core/freeSession';
import { OWNED_DEPTH } from '../../../backend/core/types';
import { depthName } from '../../lib/stages';
import { Markdown } from '../../components/Markdown';
import { SKILL_LABEL, SKILL_TONE } from './labels';

/** A skill, with its ideas and how deep each is planned when opened. */
export function SkillRow({
  skill,
  open,
  onToggle,
  deeper,
  onGoDeeper,
  onLearn,
  onPractise,
  writing = false,
}: {
  skill: GoalDetail['capabilities'][number];
  open: boolean;
  onToggle: () => void;
  deeper: Map<string, GoalDetail['simplified']['ideas'][number]>;
  onGoDeeper: (nodeId: string) => void;
  /** Planned skills only: choose a session on the ideas not yet at their planned depth. */
  onLearn?: (nodeIds: string[], testMe?: boolean) => void;
  /** Planned skills only: new problems on the ideas already learned, at a chosen level. */
  onPractise?: (nodeIds: string[], level: PracticeLevel) => void;
  /** Problems are being written. */
  writing?: boolean;
}) {
  const [level, setLevel] = useState<PracticeLevel>('normal');
  const toLearn = skill.targets.filter((t) => t.depth > 0 && t.currentDepth < t.depth).map((t) => t.nodeId);
  const learned = skill.targets.filter((t) => t.currentDepth >= OWNED_DEPTH).map((t) => t.nodeId);
  return (
    <li className="flex flex-col gap-[12px]">
      <button type="button" className="row skill-head" aria-expanded={open} onClick={onToggle}>
        <span className="flex min-w-0 items-start gap-[10px]">
          <span className={open ? 'chevron is-open' : 'chevron'} aria-hidden="true" />
          <span className="flex min-w-0 flex-col gap-[2px]">
            <Markdown text={skill.statement} inline />
            {skill.request && <span className="added-mark">You added this · “{skill.request}”</span>}
          </span>
        </span>
        <span className={`t-small shrink-0 ${skill.planned ? SKILL_TONE[skill.status] : 'text-muted'}`}>{skill.planned ? SKILL_LABEL[skill.status] : 'Left out'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-[10px]">
          <ul className="skill-ideas">
            {skill.targets.map((t) => {
              const simple = deeper.get(t.nodeId);
              return (
                <li key={t.nodeId}>
                  <span className="flex min-w-0 flex-col gap-[2px]">
                    <Markdown text={t.name} inline />
                    {simple && (
                      <span className="t-small text-muted">
                        Simplified: {simple.reason}.{' '}
                        <button type="button" className="link-button" onClick={() => onGoDeeper(t.nodeId)}>
                          Go deeper · adds about {simple.minutes} min
                        </button>
                      </span>
                    )}
                  </span>
                  <DepthPips current={t.currentDepth} planned={t.depth} ideal={t.idealDepth} />
                </li>
              );
            })}
          </ul>
          <div className="pip-legend">
            <span>
              <i className="pip is-known" /> you know
            </span>
            <span>
              <i className="pip is-planned" /> planned
            </span>
            <span>
              <i className="pip is-ideal" /> the goal asks, beyond your time
            </span>
          </div>
          {((onLearn && toLearn.length > 0) || (onPractise && learned.length > 0)) && (
            <div className="skill-actions">
              {onPractise && learned.length > 0 && (
                <>
                  <button type="button" className="link-button" disabled={writing} onClick={() => onPractise(learned, level)}>
                    {writing ? 'Writing problems…' : learned.length === skill.targets.length ? 'Practise this skill now' : 'Practise what you have learned'}
                  </button>
                  <select className="select-quiet" aria-label="How hard the problems are" value={level} disabled={writing} onChange={(e) => setLevel(e.target.value as PracticeLevel)}>
                    <option value="easier">Easier</option>
                    <option value="normal">As planned</option>
                    <option value="harder">Harder</option>
                  </select>
                </>
              )}
              {onLearn && toLearn.length > 0 && (
                <span className="ml-auto flex flex-wrap gap-x-[16px] gap-y-[4px]">
                  <button type="button" className="link-button" title="A question on each that shows you know it, with nothing explained first" onClick={() => onLearn(toLearn.slice(0, MAX_FREE_IDEAS), true)}>
                    I know these: test me
                  </button>
                  <button type="button" className="link-button" onClick={() => onLearn(toLearn.slice(0, MAX_FREE_IDEAS))}>
                    Learn these now
                  </button>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Five pips: filled up to what you know, ringed up to what the plan holds, faint up to what the goal asks. */
function DepthPips({ current, planned, ideal }: { current: number; planned: number; ideal: number }) {
  const label = `${depthName(current)} now; planned: ${planned ? depthName(planned) : 'left out'}${planned < ideal ? `; the goal asks ${depthName(ideal)}` : ''}`;
  return (
    <span className="depth-pips" role="img" aria-label={label} title={label}>
      {[1, 2, 3, 4, 5].map((d) => (
        <span key={d} className={d <= current ? 'pip is-known' : d <= planned ? 'pip is-planned' : d <= ideal ? 'pip is-ideal' : 'pip'} />
      ))}
    </span>
  );
}
