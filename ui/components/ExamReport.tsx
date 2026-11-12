import { useEffect, useState } from 'react';
import type { ExamReport } from '../../backend/api/contract';
import { Meter } from './controls';
import { Markdown } from './Markdown';

/** Seconds until `endsAt`, ticking each second; null with no deadline, never below zero. */
export function useSecondsLeft(endsAt: string | null): number | null {
  const left = () => (endsAt ? Math.max(0, Math.round((new Date(endsAt).getTime() - Date.now()) / 1000)) : null);
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    setSeconds(left());
    if (!endsAt) return;
    const timer = setInterval(() => setSeconds(left()), 1000);
    return () => clearInterval(timer);
  }, [endsAt]);
  return seconds;
}

/** Minutes left, and the seconds too in the last five minutes. */
export function formatLeft(seconds: number): string {
  if (seconds >= 300) return `${Math.ceil(seconds / 60)} min`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The report of a mock exam (design §5.1): points, a score per skill, and what to work on. */
export function ExamReportView({ report, names }: { report: ExamReport; names: Map<string, string> }) {
  const percent = report.maxPoints ? Math.round((report.points / report.maxPoints) * 100) : 0;
  const tested = report.skills.filter((s) => s.score !== null);
  const untested = report.skills.length - tested.length;
  return (
    <section className="exam-report" aria-label="Report">
      <div className="flex flex-col gap-[6px]">
        <h2 className="t-heading m-0">
          {formatPoints(report.points)} of {report.maxPoints} points ({percent}%)
        </h2>
        <p className="t-small m-0 text-secondary">
          {report.answered} of {report.maxPoints / 10} problems answered.
          {report.pending > 0 ? ` ${report.pending === 1 ? 'One grade is' : `${report.pending} grades are`} still arriving; the report fills in as they land.` : ''}
        </p>
      </div>
      {tested.length > 0 && (
        <ul className="exam-skills">
          {tested
            .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
            .map((s) => (
              <li key={s.id} className="exam-skill">
                <Markdown text={s.statement} inline className="exam-skill-name" />
                <Meter value={(s.score ?? 0) / 10} accent={(s.score ?? 0) >= 7} />
                <span className="t-small text-secondary">{s.score?.toFixed(1)}/10</span>
              </li>
            ))}
        </ul>
      )}
      {untested > 0 && <p className="t-small m-0 text-muted">{untested === 1 ? '1 skill was' : `${untested} skills were`} not on this exam.</p>}
      {report.weak.length > 0 && (
        <p className="m-0 text-soft">
          To work on: <Markdown inline text={report.weak.map((id) => names.get(id) ?? id).join(', ')} />. They come back in your next sessions and practice, and the goal page lists them under the problems you missed.
        </p>
      )}
    </section>
  );
}

function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}
