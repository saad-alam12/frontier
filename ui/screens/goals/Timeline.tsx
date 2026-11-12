/** A goal's lectures or material in order, with how much of each is yours. */
import type { GoalDetail, MaterialView } from '../../../backend/api/contract';
import { formatHours } from '../../../backend/core/budget';
import { Meter } from '../../components/controls';
import { VerticalPath } from '../../components/paths';
import type { PointState } from '../../components/paths';
import { dateLabel, formatDate, plural } from './labels';

/** A lecture counts as done once this share of its ideas is yours. */
const LECTURE_DONE = 0.8;

/** Uploaded lectures with how much is yours, what the scope says is coming, and the exam. */
export function Timeline({ detail, teaching }: { detail: GoalDetail; teaching: MaterialView[] }) {
  const { goal } = detail;
  const share = (m: MaterialView) => (m.ideas ? m.owned / m.ideas : 0);
  const currentIndex = teaching.findIndex((m) => share(m) < LECTURE_DONE);
  const times = new Map((detail.progress?.resources ?? []).map((r) => [r.sourceId, r]));
  const timeText = (sourceId: string) => {
    const t = times.get(sourceId);
    if (!t || (!t.minutes && !t.targetMinutes)) return '';
    return ` · ${formatHours(t.minutes)}${t.targetMinutes ? ` of ${formatHours(t.targetMinutes)}` : ''}`;
  };
  const items: { key: string; state: PointState; children: React.ReactNode }[] = teaching.map((m, i) => {
    const state: PointState = i === currentIndex ? 'current' : share(m) >= LECTURE_DONE ? 'done' : 'upcoming';
    const reading = m.status !== 'done' && m.status !== 'failed';
    return {
      key: m.sourceId,
      state,
      children: (
        <div className="flex items-center justify-between gap-[16px]">
          <div className="flex min-w-0 flex-col">
            <span className={state === 'current' ? 'font-medium' : state === 'upcoming' ? 'text-secondary' : undefined}>{m.title}</span>
            <span className="t-small text-muted">
              {reading ? `Reading, ${m.chunksDone} of ${m.chunkCount} parts` : `${plural(m.ideas, 'idea')} · ${m.owned} yours${timeText(m.sourceId)}${state === 'current' ? ' · learning now' : ''}`}
            </span>
          </div>
          {!reading && m.ideas > 0 && <Meter value={share(m)} accent={state === 'current'} />}
        </div>
      ),
    };
  });
  for (const unit of goal.coursePlan) {
    items.push({
      key: `plan-${unit.title}`,
      state: 'upcoming',
      children: (
        <div className="flex flex-col">
          <span className="text-secondary">{unit.title}</span>
          {unit.expected && <span className="t-small text-muted">Expected {unit.expected}</span>}
        </div>
      ),
    });
  }
  const dateName = dateLabel(goal.assessment);
  if (goal.date && dateName) {
    const exam = dateName === 'Exam date';
    const mocks = goal.assessment === 'written_exam' ? mockStart(goal.date) : null;
    items.push({
      key: 'milestone',
      state: 'milestone',
      children: (
        <div className="flex flex-col">
          <span>{exam ? 'Exam' : 'Deadline'}</span>
          <span className="t-small text-muted">
            {formatDate(goal.date, false)}
            {mocks ? ` · mock exams from ${mocks}` : ''}
          </span>
        </div>
      ),
    });
  }
  return <VerticalPath items={items} />;
}

/** Mock exams start four weeks before a written exam (design §3, M5). */
function mockStart(date: string): string | null {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() - 28);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}
