/**
 * Stats (design §10.2): what the activity log, the evidence and the plans say about how the learner
 * learns, filtered by goal, topic and time range, plus a few plain sentences worth knowing. Everything
 * here is read-only arithmetic over stored data.
 */
import { addDays, daysBetween, localDate, startOfDay, weekStart } from '../core/dates';
import { formatHours, ideaMinutes } from '../core/budget';
import { topics } from '../core/clusters';
import { recallProbability } from '../core/fsrs';
import { depthsAlong } from '../core/nodeState';
import { worldGraph } from './worldGraph';
import { CONFIDENCE_LEVELS, OWNED_DEPTH } from '../core/types';
import type { Evidence, KnowledgeNode, NodeState } from '../core/types';
import type { Database } from '../store/db';
import { listEvidenceSince, listStates } from '../store/evidence';
import { listCapabilities, listGoals, listTargets } from '../store/goals';
import { listSessions } from '../store/sessions';
import { attributeTime, freeStudy, goalProgress, learnerSpeedNow } from './budget';

const DAY_MS = 86_400_000;
export const STATS_RANGES = ['7d', '30d', '90d', 'all'] as const;
export type StatsRange = (typeof STATS_RANGES)[number];
export const RANGE_DAYS: Record<StatsRange, number | null> = { '7d': 7, '30d': 30, '90d': 90, all: null };

export interface StatsFilter {
  goalId: string | null;
  topicId: string | null;
  range: StatsRange;
}

export interface StatsView {
  filter: StatsFilter;
  goals: { id: string; title: string; status: string }[];
  topics: { id: string; name: string; size: number }[];
  headline: { minutes: number; sessions: number; ideasLearned: number; ideasOwned: number; streakDays: number; answers: number; avgScore: number | null };
  /** Minutes per week by goal (key 'free' for free study), oldest first, with the weekly rhythm the budgets ask for. */
  weeks: { start: string; minutes: Record<string, number>; target: number | null }[];
  /** The last twelve weeks, a day each, for the calendar. */
  days: { date: string; minutes: number }[];
  /** Ideas recognized (depth 1+), owned (depth 2+) and deep (3+) over time. */
  growth: { date: string; recognized: number; owned: number; deep: number }[];
  retention: { now: number | null; inAMonth: number | null; curve: { day: number; recall: number }[]; buckets: { label: string; count: number }[] };
  calibration: { label: string; confidence: number; avgScore: number; count: number }[];
  hours: { hour: number; minutes: number; avgScore: number | null; answers: number }[];
  hardest: { nodeId: string; name: string; attempts: number; avgScore: number; lastScore: number }[];
  misconceptions: { nodeId: string; idea: string; description: string; firstSeen: string; lastSeen: string; cameBack: boolean; resolved: boolean }[];
  overlap: { savedMinutes: number; ideas: { nodeId: string; name: string; goals: string[]; depth: number }[] };
  /** `noLimit`: a goal with no time limit, whose plan is what is left rather than a budget. */
  budgets: { goalId: string; title: string; totalMinutes: number | null; spentMinutes: number; plannedMinutes: number; noLimit: boolean; ready: number; planned: number; pace: string }[];
  /** Learner speed against the plan's estimates; 1 means as planned. */
  speed: number;
  /** Minutes of free study in the range: chosen sessions booked to no goal (none under a goal filter). */
  freeMinutes: number;
  facts: string[];
}

interface BugRow {
  id: string;
  node_id: string;
  description: string;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
}

/** The key under which time for goals that no longer exist is shown. */
export const REMOVED_GOALS = 'removed';

export function statsView(db: Database, filter: StatsFilter, now = new Date()): StatsView {
  const days = RANGE_DAYS[filter.range];
  const since = days === null ? null : new Date(now.getTime() - days * DAY_MS).toISOString();
  const allGoals = listGoals(db).filter((g) => g.status !== 'draft');
  const goalTitle = new Map(allGoals.map((g) => [g.id, g.title ?? g.text]));
  const { nodes, index, centrality } = worldGraph(db);
  const states = listStates(db);
  const caps = new Map(listCapabilities(db).map((c) => [c.id, c.goalId]));
  const targets = listTargets(db);
  const goalsOfNode = new Map<string, Set<string>>();
  for (const t of targets) {
    const g = caps.get(t.capabilityId);
    if (g && allGoals.find((x) => x.id === g)?.status === 'active') goalsOfNode.set(t.nodeId, (goalsOfNode.get(t.nodeId) ?? new Set()).add(g));
  }

  // topics over the ideas that matter to the learner: targeted or touched
  const relevant = [...nodes.keys()].filter((id) => goalsOfNode.has(id) || (states.get(id)?.depth ?? 0) > 0);
  const topicList = topics(relevant, index, new Map([...nodes.values()].map((n) => [n.id, n.name])), centrality);
  const topic = filter.topicId ? topicList.find((t) => t.id === filter.topicId) : undefined;
  const goalNodes = filter.goalId ? new Set(targets.filter((t) => caps.get(t.capabilityId) === filter.goalId).map((t) => t.nodeId)) : null;
  const topicNodes = topic ? new Set(topic.nodeIds) : null;
  const nodeIn = (id: string | null) => {
    if (topicNodes && (!id || !topicNodes.has(id))) return false;
    if (goalNodes && id && !goalNodes.has(id)) return false;
    return true;
  };

  // time: each goal's, and free study as a line of its own (it belongs to no goal)
  const inTopic = (s: { span: { nodeId: string | null } }) => !topicNodes || (s.span.nodeId !== null && topicNodes.has(s.span.nodeId));
  const free = filter.goalId ? [] : freeStudy(db).filter(inTopic).map((s) => ({ ...s, goalId: 'free' }));
  // time spent for a goal that was removed since is still time studied: it is kept under one name
  const known = new Set(allGoals.map((g) => g.id));
  const attributed = attributeTime(db).map((s) => (known.has(s.goalId) ? s : { ...s, goalId: REMOVED_GOALS }));
  const shares = [...attributed.filter((s) => (!filter.goalId || s.goalId === filter.goalId) && inTopic(s)), ...free];
  const inRange = shares.filter((s) => !since || s.span.endedAt >= since);
  const minutes = inRange.reduce((sum, s) => sum + s.minutes, 0);

  // evidence the learner produced (implicit credit and lookups are not answers)
  const evidence = listEvidenceSince(db, '0000').filter((e) => !e.context.implicit && nodeIn(e.nodeId) && (!filter.goalId || goalNodes?.has(e.nodeId)));
  const answers = evidence.filter((e) => e.kind !== 'lookup' && (!since || e.at >= since));
  const avgScore = answers.length ? answers.reduce((s, e) => s + e.score, 0) / answers.length : null;

  // depth history, replayed from evidence
  const transitions = depthHistory(listEvidenceSince(db, '0000').filter((e) => nodeIn(e.nodeId) && (!goalNodes || goalNodes.has(e.nodeId))));
  const growth = growthSeries(transitions, since ?? transitions[0]?.at ?? now.toISOString(), now);
  const learnedInRange = new Set(transitions.filter((t) => t.to >= OWNED_DEPTH && t.from < OWNED_DEPTH && (!since || t.at >= since)).map((t) => t.nodeId)).size;

  const scoped = [...states.values()].filter((s) => nodeIn(s.nodeId) && (!goalNodes || goalNodes.has(s.nodeId)));
  const ownedStates = scoped.filter((s) => s.depth >= OWNED_DEPTH);
  const sessions = listSessions<{ goalId?: string }>(db, 10_000).filter((s) => (!since || s.startedAt >= since) && (!filter.goalId || s.goalId === filter.goalId)).length;

  const weeks = weekSeries(inRange, since, now, allGoals, filter.goalId, db);
  const daySeries = calendar(shares, now);
  const retention = retentionOf(ownedStates, now);
  const calibration = CONFIDENCE_LEVELS.map((level) => {
    const hits = answers.filter((e) => e.confidence !== null && nearest(e.confidence) === level.value);
    return { label: level.label, confidence: level.value, avgScore: hits.length ? hits.reduce((s, e) => s + e.score, 0) / hits.length : 0, count: hits.length };
  });
  const hours = hourSeries(inRange, answers);
  const hardest = hardestIdeas(answers, nodes);
  const misconceptions = (db.prepare('SELECT * FROM bugs ORDER BY last_seen DESC').all() as unknown as BugRow[])
    .filter((b) => nodeIn(b.node_id) && (!goalNodes || goalNodes.has(b.node_id)) && (!since || b.last_seen >= since))
    .slice(0, 8)
    .map((b) => ({ nodeId: b.node_id, idea: nodes.get(b.node_id)?.name ?? b.node_id, description: b.description, firstSeen: b.first_seen, lastSeen: b.last_seen, cameBack: new Date(b.last_seen).getTime() - new Date(b.first_seen).getTime() > 3_600_000, resolved: b.resolved_at !== null }));

  const overlapIdeas = [...goalsOfNode.entries()]
    .filter(([id, gs]) => gs.size > 1 && nodeIn(id) && (!filter.goalId || gs.has(filter.goalId)))
    .map(([id, gs]) => ({ nodeId: id, name: nodes.get(id)?.name ?? id, goals: [...gs].map((g) => goalTitle.get(g) ?? g), depth: states.get(id)?.depth ?? 0 }))
    .sort((a, b) => b.goals.length - a.goals.length || b.depth - a.depth || a.name.localeCompare(b.name));
  const savedMinutes = overlapIdeas.reduce((s, o) => s + ideaMinutes(nodes.get(o.nodeId)?.kind ?? 'claim', 0, o.depth) * (o.goals.length - 1), 0);

  const budgets = allGoals
    .filter((g) => g.status === 'active' && (!filter.goalId || g.id === filter.goalId))
    .map((g) => ({ g, p: goalProgress(db, g.id, now) }))
    .filter((x): x is { g: (typeof allGoals)[number]; p: NonNullable<ReturnType<typeof goalProgress>> } => x.p !== null)
    .map(({ g, p }) => ({
      goalId: g.id,
      title: g.title ?? g.text,
      totalMinutes: p.totalMinutes,
      spentMinutes: p.spentMinutes,
      plannedMinutes: p.plan.plannedMinutes,
      noLimit: p.noLimit,
      ready: p.plan.ideas.ready,
      planned: p.plan.ideas.total - p.plan.ideas.cut,
      pace: p.pace.kind,
    }));

  // the learner's speed is one number, the one the plans use, whatever the filter shows
  const speed = learnerSpeedNow(db);

  const view: StatsView = {
    filter,
    goals: allGoals.map((g) => ({ id: g.id, title: g.title ?? g.text, status: g.status })),
    topics: topicList.map((t) => ({ id: t.id, name: t.name, size: t.nodeIds.length })),
    headline: { minutes: Math.round(minutes), sessions, ideasLearned: learnedInRange, ideasOwned: ownedStates.length, streakDays: streak(daySeries, now), answers: answers.length, avgScore },
    weeks,
    days: daySeries,
    growth,
    retention,
    calibration,
    hours,
    hardest,
    misconceptions,
    overlap: { savedMinutes: Math.round(savedMinutes), ideas: overlapIdeas.slice(0, 12) },
    budgets,
    speed,
    freeMinutes: Math.round(inRange.filter((s) => s.goalId === 'free').reduce((sum, s) => sum + s.minutes, 0)),
    facts: [],
  };
  view.facts = facts(view);
  return view;
}

export interface Transition {
  nodeId: string;
  at: string;
  from: number;
  to: number;
}

/** Every change of depth, by replaying each idea's evidence in order. */
export function depthHistory(evidence: Evidence[]): Transition[] {
  const byNode = new Map<string, Evidence[]>();
  for (const e of evidence) {
    const list = byNode.get(e.nodeId);
    if (list) list.push(e);
    else byNode.set(e.nodeId, [e]);
  }
  const out: Transition[] = [];
  for (const [nodeId, list] of byNode) {
    let depth = 0;
    for (const step of depthsAlong(list)) {
      if (step.depth !== depth) out.push({ nodeId, at: step.evidence.at, from: depth, to: step.depth });
      depth = step.depth;
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * What the learner knows over time: a point every few days (at most about sixty), each counting the
 * ideas at each depth by the end of that local day, and always a last point for right now, so the
 * chart ends where the headline numbers are.
 */
export function growthSeries(transitions: Transition[], fromIso: string, now: Date): StatsView['growth'] {
  const start = startOfDay(new Date(fromIso));
  const span = Math.max(1, daysBetween(start, now));
  const step = Math.max(1, Math.ceil(span / 60));
  const points: { until: Date; date: string }[] = [];
  for (let d = 0; d < span; d += step) points.push({ until: addDays(start, d + 1), date: localDate(addDays(start, d)) });
  points.push({ until: new Date(now.getTime() + 1), date: localDate(now) });
  const depth = new Map<string, number>();
  const out: StatsView['growth'] = [];
  let i = 0;
  for (const point of points) {
    const until = point.until.toISOString();
    while (i < transitions.length && (transitions[i] as Transition).at < until) {
      const t = transitions[i] as Transition;
      depth.set(t.nodeId, t.to);
      i += 1;
    }
    const ds = [...depth.values()];
    out.push({ date: point.date, recognized: ds.filter((x) => x >= 1).length, owned: ds.filter((x) => x >= OWNED_DEPTH).length, deep: ds.filter((x) => x >= 3).length });
  }
  return out;
}

function weekSeries(shares: ReturnType<typeof attributeTime>, since: string | null, now: Date, goals: ReturnType<typeof listGoals>, goalId: string | null, db: Database): StatsView['weeks'] {
  const first = since ? new Date(since) : shares[0] ? new Date(shares[0].span.at) : now;
  const count = Math.max(8, Math.min(26, Math.ceil((now.getTime() - weekStart(first).getTime()) / (7 * DAY_MS))));
  const startNow = weekStart(now);
  const target = goals
    .filter((g) => g.status === 'active' && (!goalId || g.id === goalId))
    .reduce((s, g) => s + (goalProgress(db, g.id, now)?.weeklyTarget ?? 0), 0);
  const out: StatsView['weeks'] = [];
  for (let w = count - 1; w >= 0; w -= 1) {
    const start = addDays(startNow, -7 * w);
    const end = addDays(start, 7);
    const minutes: Record<string, number> = {};
    for (const s of shares) {
      const at = new Date(s.span.endedAt);
      if (at < start || at >= end) continue;
      minutes[s.goalId] = (minutes[s.goalId] ?? 0) + s.minutes;
    }
    for (const k of Object.keys(minutes)) minutes[k] = Math.round(minutes[k] as number);
    out.push({ start: localDate(start), minutes, target: target || null });
  }
  return out;
}

/** The last twelve weeks, a day each (all time in the filter, so the calendar never looks empty for a short range). */
/** The study streak alone, for Today. */
export function streakDays(db: Database, now = new Date()): number {
  return streak(calendar([...attributeTime(db), ...freeStudy(db)], now), now);
}

export function calendar(shares: { minutes: number; span: { endedAt: string } }[], now: Date): StatsView['days'] {
  const first = addDays(weekStart(now), 7 - 12 * 7);
  const byDay = new Map<string, number>();
  for (const s of shares) {
    const at = new Date(s.span.endedAt);
    if (at < first) continue;
    const key = localDate(at);
    byDay.set(key, (byDay.get(key) ?? 0) + s.minutes);
  }
  const out: StatsView['days'] = [];
  for (let i = 0; i < 12 * 7; i += 1) {
    const key = localDate(addDays(first, i));
    out.push({ date: key, minutes: Math.round(byDay.get(key) ?? 0) });
  }
  return out;
}

/** Days in a row with at least five minutes of study, ending today (or yesterday, before today's study). */
function streak(days: StatsView['days'], now = new Date()): number {
  const today = localDate(now);
  const list = days.filter((d) => d.date <= today);
  let i = list.length - 1;
  if (i >= 0 && (list[i]?.minutes ?? 0) < 5) i -= 1;
  let n = 0;
  for (; i >= 0 && (list[i]?.minutes ?? 0) >= 5; i -= 1) n += 1;
  return n;
}

function retentionOf(owned: NodeState[], now: Date): StatsView['retention'] {
  if (!owned.length) return { now: null, inAMonth: null, curve: [], buckets: [] };
  const at = (day: number) => owned.reduce((s, st) => s + recallProbability(st.fsrs, new Date(now.getTime() + day * DAY_MS)), 0) / owned.length;
  const curve = Array.from({ length: 13 }, (_, i) => ({ day: i * 5, recall: at(i * 5) }));
  const buckets = [
    { label: 'Under 50%', min: 0, max: 0.5 },
    { label: '50–70%', min: 0.5, max: 0.7 },
    { label: '70–85%', min: 0.7, max: 0.85 },
    { label: '85–95%', min: 0.85, max: 0.95 },
    { label: '95% and up', min: 0.95, max: 1.01 },
  ].map((b) => ({ label: b.label, count: owned.filter((st) => { const r = recallProbability(st.fsrs, now); return r >= b.min && r < b.max; }).length }));
  return { now: at(0), inAMonth: at(30), curve, buckets };
}

function nearest(value: number): number {
  let best: number = CONFIDENCE_LEVELS[0].value;
  for (const level of CONFIDENCE_LEVELS) if (Math.abs(level.value - value) < Math.abs(best - value)) best = level.value;
  return best;
}

function hourSeries(shares: ReturnType<typeof attributeTime>, answers: Evidence[]): StatsView['hours'] {
  const out = Array.from({ length: 24 }, (_, hour) => ({ hour, minutes: 0, scoreSum: 0, answers: 0 }));
  for (const s of shares) {
    const slot = out[new Date(s.span.at).getHours()];
    if (slot) slot.minutes += s.minutes;
  }
  for (const e of answers) {
    const slot = out[new Date(e.at).getHours()];
    if (slot) {
      slot.scoreSum += e.score;
      slot.answers += 1;
    }
  }
  return out.map((o) => ({ hour: o.hour, minutes: Math.round(o.minutes), avgScore: o.answers ? o.scoreSum / o.answers : null, answers: o.answers }));
}

function hardestIdeas(answers: Evidence[], nodes: Map<string, KnowledgeNode>): StatsView['hardest'] {
  const byNode = new Map<string, Evidence[]>();
  for (const e of answers) byNode.set(e.nodeId, [...(byNode.get(e.nodeId) ?? []), e]);
  return [...byNode.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([nodeId, list]) => {
      const ordered = [...list].sort((a, b) => a.at.localeCompare(b.at));
      return { nodeId, name: nodes.get(nodeId)?.name ?? nodeId, attempts: list.length, avgScore: list.reduce((s, e) => s + e.score, 0) / list.length, lastScore: (ordered[ordered.length - 1] as Evidence).score };
    })
    .filter((x) => x.avgScore < 0.75)
    .sort((a, b) => a.avgScore - b.avgScore || b.attempts - a.attempts)
    .slice(0, 6);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Plain sentences, only where the numbers say something clear. */
function facts(view: StatsView): string[] {
  const out: string[] = [];
  const top = view.overlap.ideas.find((o) => o.depth >= 1);
  if (top && view.overlap.savedMinutes >= 15) {
    out.push(`Learning shared ideas once has saved you about ${formatHours(view.overlap.savedMinutes)}. “${top.name}” alone serves ${top.goals.join(' and ')}.`);
  }
  const sure = view.calibration.find((c) => c.confidence === 0.9);
  const guess = view.calibration.find((c) => c.confidence === 0.33);
  if (sure && sure.count >= 5) {
    if (sure.avgScore >= 0.85) out.push(`When you say you are sure, you are right: ${pct(sure.avgScore)} on average.`);
    else out.push(`When you say you are sure, you score ${pct(sure.avgScore)}. Those are the answers worth a second look.`);
  }
  if (guess && guess.count >= 5 && guess.avgScore >= 0.7) out.push(`Your guesses score ${pct(guess.avgScore)}: you know more than you think.`);
  const slots = [
    { label: 'in the morning', hours: [5, 6, 7, 8, 9, 10, 11] },
    { label: 'in the afternoon', hours: [12, 13, 14, 15, 16, 17] },
    { label: 'in the evening', hours: [18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4] },
  ].map((s) => {
    const hs = view.hours.filter((h) => s.hours.includes(h.hour));
    const n = hs.reduce((a, h) => a + h.answers, 0);
    return { label: s.label, n, avg: n ? hs.reduce((a, h) => a + (h.avgScore ?? 0) * h.answers, 0) / n : 0 };
  });
  const usable = slots.filter((s) => s.n >= 8).sort((a, b) => b.avg - a.avg);
  if (usable.length >= 2 && (usable[0]?.avg ?? 0) - (usable[usable.length - 1]?.avg ?? 0) >= 0.1) {
    out.push(`You answer best ${usable[0]?.label} (${pct(usable[0]?.avg ?? 0)}), and least well ${usable[usable.length - 1]?.label} (${pct(usable[usable.length - 1]?.avg ?? 0)}).`);
  }
  const r = view.retention;
  if (r.now !== null && r.inAMonth !== null && r.now - r.inAMonth >= 0.05) out.push(`Without practice, your average recall would fall from ${pct(r.now)} to ${pct(r.inAMonth)} in a month. Practice on Today keeps it up.`);
  if (view.speed >= 1.3) out.push(`New ideas take you about ${view.speed.toFixed(1)}× the time the plan estimates, so plans now allow for it.`);
  else if (view.speed <= 0.75) out.push(`You learn faster than the plan estimates (about ${view.speed.toFixed(1)}× its time), so the same hours now go further.`);
  if (view.headline.streakDays >= 3) out.push(`${view.headline.streakDays} days in a row with study.`);
  const recurring = view.misconceptions.filter((m) => m.cameBack && !m.resolved);
  if (recurring[0]) out.push(`One misconception keeps coming back in ${recurring[0].idea}: “${recurring[0].description}”`);
  const totals = new Map<string, number>();
  for (const w of view.weeks) for (const [g, m] of Object.entries(w.minutes)) totals.set(g, (totals.get(g) ?? 0) + m);
  const [lead, leadMinutes] = [...totals.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  const all = [...totals.values()].reduce((a, b) => a + b, 0);
  if (lead && leadMinutes && totals.size > 1 && leadMinutes / all >= 0.6) out.push(`${pct(leadMinutes / all)} of your time went to ${view.goals.find((g) => g.id === lead)?.title ?? 'one goal'}.`);
  return out.slice(0, 5);
}
