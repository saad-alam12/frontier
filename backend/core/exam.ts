/**
 * Exam mode (design §5.1, "Mock exams"): a mock exam is timed, shows no solution or grade until it is
 * handed in or its time is up, and ends with a report per skill. Pure.
 */
import { PASS_SCORE } from './types';

/** A problem of an exam takes about this long, as exam problems go (several ideas, a written answer). */
const MINUTES_PER_PROBLEM = 12;

/** The time for a mock exam: about twelve minutes a problem, never more than the real exam takes, at least ten. */
export function examMinutes(problems: number, realExamMinutes: number | null): number {
  const asked = problems * MINUTES_PER_PROBLEM;
  const capped = realExamMinutes && realExamMinutes > 0 ? Math.min(asked, realExamMinutes) : asked;
  return Math.max(10, Math.round(capped / 5) * 5);
}

/** When the exam's time ends, and whether it is over (handed in, or out of time). */
export function examClock(set: { createdAt: string; minutes: number; handedInAt: string | null }, now: Date): { endsAt: string; over: boolean } {
  const endsAt = new Date(new Date(set.createdAt).getTime() + set.minutes * 60_000);
  return { endsAt: endsAt.toISOString(), over: set.handedInAt !== null || now.getTime() >= endsAt.getTime() };
}

export interface ExamProblem {
  nodeIds: string[];
  answered: boolean;
  /** 0–10, null until graded (or never, when not answered). */
  score: number | null;
  /** 0–10 per idea, from the grade. */
  ideaScores: Map<string, number>;
}

export interface ExamReport {
  /** Points over all problems; an unanswered problem counts zero. */
  points: number;
  maxPoints: number;
  answered: number;
  /** Grades still arriving for answered problems. */
  pending: number;
  /** Per skill of the goal: the mean of its tested ideas' scores (0–10), or null when the exam did not test it. */
  skills: { id: string; statement: string; score: number | null; tested: number }[];
  /** Ideas the exam tested that scored below the pass mark (an unanswered problem's ideas included). */
  weak: string[];
}

export function examReport(problems: ExamProblem[], skills: { id: string; statement: string; nodeIds: string[] }[]): ExamReport {
  const scores = new Map<string, number[]>();
  for (const p of problems) {
    for (const id of p.nodeIds) {
      // a problem left unanswered tested its ideas and found nothing
      const score = p.answered ? p.ideaScores.get(id) : 0;
      if (score === undefined) continue;
      scores.set(id, [...(scores.get(id) ?? []), score]);
    }
  }
  const mean = (list: number[]) => list.reduce((s, x) => s + x, 0) / list.length;
  const ideaMean = new Map([...scores].map(([id, list]) => [id, mean(list)]));
  return {
    points: problems.reduce((s, p) => s + (p.answered ? (p.score ?? 0) : 0), 0),
    maxPoints: problems.length * 10,
    answered: problems.filter((p) => p.answered).length,
    pending: problems.filter((p) => p.answered && p.score === null).length,
    skills: skills.map((s) => {
      const tested = s.nodeIds.filter((id) => ideaMean.has(id));
      return { id: s.id, statement: s.statement, tested: tested.length, score: tested.length ? Math.round(mean(tested.map((id) => ideaMean.get(id) as number)) * 10) / 10 : null };
    }),
    weak: [...ideaMean].filter(([, score]) => score < PASS_SCORE * 10).map(([id]) => id),
  };
}
