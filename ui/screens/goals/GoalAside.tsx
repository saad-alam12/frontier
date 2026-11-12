import type { GoalDetail, MaterialRole } from '../../../backend/api/contract';
import { formatHours } from '../../../backend/core/budget';
import { DefGrid, Meter } from '../../components/controls';
import { Markdown } from '../../components/Markdown';
import { ROLE_OPTIONS } from './labels';

const ROLE_PLURAL: Record<MaterialRole, string> = { teaching: 'Teaching content', practice: 'Practice', assessment: 'Past exams', scope: 'Scope', reference: 'Reference' };

/** The side panel of a goal: today's work, time per lecture or source, the exam's style, the material. */
export function GoalAside({ detail, onEdit }: { detail: GoalDetail; onEdit: () => void }) {
  const { goal, progress } = detail;
  const course = goal.kind === 'course';
  return (
    <>
      {detail.schedule && (
        <div className="flex flex-col gap-[14px]">
          <h2 className="t-title">Today</h2>
          <p className="t-lead m-0">
            <span className="text-text">{MODE_LABEL[detail.schedule.mode]}, about {detail.schedule.dailyMinutes} minutes.</span> {detail.schedule.modeReason}
          </p>
          {detail.nextIdeas.length > 0 && (
            <div className="this-week">
              <span className="text-text">New next</span>
              <Markdown text={detail.nextIdeas.join(', then ')} inline />
            </div>
          )}
        </div>
      )}
      {progress && progress.resources.some((r) => r.minutes > 0 || r.targetMinutes) && (
        <>
          <div className="divider" />
          <div className="flex flex-col gap-[14px]">
            <div className="panel-label">Time per {course ? 'lecture' : 'source'}</div>
            <ul className="resource-times">
              {progress.resources.map((r) => (
                <li key={r.sourceId}>
                  <span className="min-w-0 truncate">{r.title}</span>
                  <span className="t-small shrink-0 text-secondary">
                    {formatHours(r.minutes)}
                    {r.targetMinutes ? ` of ${formatHours(r.targetMinutes)}` : ''}
                  </span>
                  {r.targetMinutes ? <Meter value={r.minutes / r.targetMinutes} accent={r.minutes > r.targetMinutes} /> : null}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
      {goal.examProfile && (
        <>
          <div className="divider" />
          <div className="flex flex-col gap-[10px]">
            <div className="panel-label">Exam style, from {detail.materials.filter((m) => m.role === 'assessment').map((m) => m.title).join(', ')}</div>
            <div className="t-lead">{goal.examProfile.summary}</div>
          </div>
        </>
      )}
      <div className="divider" />
      <div className="flex flex-col gap-[14px]">
        <div className="section-head">
          <div className="panel-label">Material</div>
          <button type="button" className="link-button" onClick={onEdit}>
            Add material
          </button>
        </div>
        {detail.materials.length ? (
          <DefGrid
            wide
            rows={ROLE_OPTIONS.filter((o) => detail.materials.some((m) => m.role === o.value)).map((o) => ({
              label: ROLE_PLURAL[o.value],
              value: detail.materials
                .filter((m) => m.role === o.value)
                .map((m) => m.title)
                .join(', '),
            }))}
          />
        ) : (
          <p className="m-0 text-secondary">None. The map comes from your goal and what the questions show.</p>
        )}
        {detail.materials.length > 0 && !detail.materials.some((m) => m.role === 'teaching' || m.role === 'reference') && (
          <p className="t-small m-0 text-muted">None of this is material to learn from, so the map comes from your goal itself. Add lectures, a script or notes and the map follows them.</p>
        )}
      </div>
    </>
  );
}

const MODE_LABEL = { build: 'Build', deepen: 'Deepen', consolidate: 'Consolidate' } as const;
