/**
 * The Today screen's picture (design §10): the session to continue or start, each active goal's
 * progress and what the scheduler suggests for it, what is fading, the coming days, and the
 * question the last session left for today.
 */
import { weeklyMinutes } from '../core/budget';
import { skillStatus } from '../core/goals';
import type { Assessment } from '../core/types';
import type { Database } from '../store/db';
import { getState, listEvidenceSince } from '../store/evidence';
import { listCapabilities, listGoals, listTargets } from '../store/goals';
import { activeSession, listSessions } from '../store/sessions';
import { attributeTime, goalBudgetMinutes, goalProgress } from './budget';
import type { GoalProgress } from './budget';
import { loadKnowledge } from './knowledge';
import { currentPractice, forecastAcross, goalSchedule } from './practice';
import type { FadingIdea, GoalSchedule, PracticeView } from './practice';
import type { SessionState } from './session';

export interface TodayGoal {
  goalId: string;
  title: string;
  assessment: Assessment;
  date: string | null;
  skills: { ready: number; learning: number; notStarted: number };
  /** Target ideas owned at their depth, of all targets. */
  ideas: { atDepth: number; total: number };
  schedule: GoalSchedule;
  /** Time against the budget, ideas against the plan, and pace. */
  progress: GoalProgress | null;
}

export interface TodayView {
  /** Goals still being set up, to finish first. */
  drafts: { goalId: string; title: string; mapped: boolean }[];
  /** True once any goal exists (drafts included): the welcome is for an empty app only. */
  anyGoals: boolean;
  session: { id: string; goalTitle: string; planTitle: string; where: string } | null;
  practice: PracticeView | null;
  goals: TodayGoal[];
  /** Fading ideas across all active goals, most faded first. */
  fading: (FadingIdea & { goalTitle: string })[];
  /** Ideas falling due per day for the next 14 days, across goals. */
  forecast: number[];
  preview: { question: string; goalTitle: string; date: string } | null;
  week: { sessions: number; practised: number; minutesTarget: number; minutesStudied: number };
}

const WEEK_MS = 7 * 86_400_000;

export function todayView(db: Database, now = new Date()): TodayView {
  const goals = listGoals(db).filter((g) => g.status === 'active' && listCapabilities(db, g.id).length > 0);
  const titleOf = (id: string | null) => {
    const g = goals.find((x) => x.id === id) ?? listGoals(db).find((x) => x.id === id);
    return g?.title ?? g?.text ?? '';
  };
  const view = loadKnowledge(db, now);

  const todayGoals: TodayGoal[] = goals.map((g) => {
    const targets = listTargets(db, g.id);
    const caps = listCapabilities(db, g.id).map((c) =>
      skillStatus(
        c.masteredAt,
        targets.filter((t) => t.capabilityId === c.id).map((t) => ({ depth: t.depth, currentDepth: getState(db, t.nodeId)?.depth ?? 0 })),
      ),
    );
    const unique = new Map<string, number>();
    for (const t of targets) unique.set(t.nodeId, Math.max(unique.get(t.nodeId) ?? 0, t.depth));
    const atDepth = [...unique].filter(([id, depth]) => view.owned.has(id) && (view.states.get(id)?.depth ?? 0) >= depth).length;
    return {
      goalId: g.id,
      title: g.title ?? g.text,
      assessment: g.assessment,
      date: g.date,
      skills: { ready: caps.filter((c) => c === 'ready').length, learning: caps.filter((c) => c === 'learning').length, notStarted: caps.filter((c) => c === 'not_started').length },
      ideas: { atDepth, total: unique.size },
      schedule: goalSchedule(db, g.id, now),
      progress: goalProgress(db, g.id, now),
    };
  });

  const fading = new Map<string, FadingIdea & { goalTitle: string }>();
  for (const g of todayGoals) for (const d of g.schedule.due) if (!fading.has(d.nodeId)) fading.set(d.nodeId, { ...d, goalTitle: g.title });
  const forecast = forecastAcross(
    db,
    goals.map((g) => g.id),
    now,
  );

  const active = activeSession<SessionState>(db);
  const session = active
    ? {
        id: active.id,
        goalTitle: titleOf(active.goalId),
        planTitle: active.state.plan.title,
        where: describePlace(active.state),
      }
    : null;

  const sessions = listSessions<SessionState>(db, 100);
  const lastDone = sessions.find((s) => s.status === 'done' && s.state.closing?.previewQuestion);
  const preview = lastDone?.state.closing?.previewQuestion ? { question: lastDone.state.closing.previewQuestion, goalTitle: titleOf(lastDone.goalId), date: (lastDone.endedAt ?? lastDone.startedAt).slice(0, 10) } : null;

  const weekStart = new Date(now.getTime() - WEEK_MS).toISOString();
  const practised = new Set(listEvidenceSince(db, weekStart).filter((e) => e.kind === 'practice' && !e.context.implicit).map((e) => e.nodeId)).size;
  const all = listGoals(db);
  const studied = attributeTime(db, weekStart).reduce((s, x) => s + x.minutes, 0);
  return {
    drafts: all.filter((g) => g.status === 'draft').map((g) => ({ goalId: g.id, title: g.title ?? g.text, mapped: g.compiledAt !== null })),
    anyGoals: all.length > 0,
    session,
    practice: currentPractice(db),
    goals: todayGoals,
    fading: [...fading.values()].sort((a, b) => a.recall - b.recall),
    forecast,
    preview,
    week: {
      sessions: sessions.filter((s) => s.startedAt >= weekStart).length,
      practised,
      minutesStudied: Math.round(studied),
      minutesTarget: goals.reduce((sum, g) => sum + (weeklyMinutes(g.budget, goalBudgetMinutes(db, g), g.approvedAt ?? g.createdAt, g.date) ?? 0), 0),
    },
  };
}

function describePlace(s: SessionState): string {
  if (s.phase === 'teach') {
    const step = s.plan.steps[s.stepIndex];
    return step ? `${step.name}, idea ${s.stepIndex + 1} of ${s.plan.steps.length}` : 'Teaching';
  }
  if (s.phase === 'practice') return 'Practice';
  if (s.phase === 'reconstruct') return 'Recall from last time';
  if (s.phase === 'orient') return 'Ready to begin';
  if (s.phase === 'close' || s.phase === 'preview') return 'Closing recall';
  return 'Finished';
}
