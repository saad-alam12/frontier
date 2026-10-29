import type { Database } from './db';
import { nowIso, parseJson } from './db';
import { newId } from './ids';
import type { Assessment, BackgroundGap, Capability, Coverage, Depth, ExamProfile, Goal, GoalBudget, GoalFocus, GoalKind, GoalLevel, GoalMaterial, GoalRemap, MaterialRole, Target, UpcomingUnit } from '../core/types';

interface GoalRow {
  id: string;
  text: string;
  title: string | null;
  kind: GoalKind;
  assessment: Assessment;
  target_grade: string | null;
  date: string | null;
  budget: string | null;
  focus: string;
  coverage: Coverage | null;
  baseline: string;
  priority: number;
  status: Goal['status'];
  created_at: string;
  approved_at: string | null;
  compiled_at: string | null;
  compiled_sources: string;
  exam_profile: string | null;
  course_plan: string;
  profile_sources: string;
  started_unverified: string;
  level: GoalLevel | null;
  scope: string | null;
  background: string | null;
  gaps: string;
  remap: string | null;
}
interface CapabilityRow {
  id: string;
  goal_id: string;
  statement: string;
  ord: number;
  mastered_at: string | null;
}
interface TargetRow {
  capability_id: string;
  node_id: string;
  depth: number;
  planned_depth: number | null;
  core: number;
  approved_depth: number | null;
  simplified: string | null;
}

const toGoal = (r: GoalRow): Goal => ({
  id: r.id,
  text: r.text,
  title: r.title,
  kind: r.kind,
  assessment: r.assessment,
  targetGrade: r.target_grade,
  date: r.date,
  budget: parseJson<GoalBudget | null>(r.budget, null),
  focus: parseJson<GoalFocus[]>(r.focus, []),
  coverage: r.coverage,
  baseline: parseJson<Record<string, Depth>>(r.baseline, {}),
  priority: r.priority,
  status: r.status,
  createdAt: r.created_at,
  approvedAt: r.approved_at,
  compiledAt: r.compiled_at,
  compiledSources: parseJson<string[]>(r.compiled_sources, []),
  examProfile: parseJson<ExamProfile | null>(r.exam_profile, null),
  coursePlan: parseJson<UpcomingUnit[]>(r.course_plan, []),
  profileSources: parseJson<string[]>(r.profile_sources, []),
  startedUnverified: parseJson<string[]>(r.started_unverified, []),
  level: r.level,
  scope: r.scope,
  background: r.background,
  gaps: parseJson<BackgroundGap[]>(r.gaps, []),
  remap: parseJson<GoalRemap | null>(r.remap, null),
});
const toCapability = (r: CapabilityRow): Capability => ({ id: r.id, goalId: r.goal_id, statement: r.statement, order: r.ord, masteredAt: r.mastered_at });
const toTarget = (r: TargetRow): Target => ({
  capabilityId: r.capability_id,
  nodeId: r.node_id,
  depth: (r.planned_depth ?? r.depth) as Depth,
  idealDepth: r.depth as Depth,
  core: r.core === 1,
  approvedDepth: r.approved_depth as Depth | null,
  simplified: r.simplified,
});

/** What the learner states about a goal; everything else is derived. */
export interface GoalInput {
  text: string;
  kind?: GoalKind;
  assessment?: Assessment;
  targetGrade?: string | null;
  date?: string | null;
  budget?: GoalBudget | null;
  focus?: GoalFocus[];
  priority?: number;
  /** What the learner already knows about it, in their words. */
  background?: string | null;
}

/** A new goal is active unless created as a draft to preview its plan first. */
export function createGoal(db: Database, input: GoalInput | string, options: { priority?: number; draft?: boolean } = {}): Goal {
  const g: GoalInput = typeof input === 'string' ? { text: input, priority: options.priority ?? 1 } : input;
  const id = newId('goal');
  const now = nowIso();
  db.prepare(
    'INSERT INTO goals (id, text, kind, assessment, target_grade, date, budget, focus, priority, status, created_at, approved_at, compiled_at, background) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)',
  ).run(
    id,
    g.text,
    g.kind ?? 'personal',
    g.assessment ?? 'none',
    g.targetGrade ?? null,
    g.date ?? null,
    g.budget ? JSON.stringify(g.budget) : null,
    JSON.stringify(g.focus ?? []),
    g.priority ?? 1,
    options.draft ? 'draft' : 'active',
    now,
    options.draft ? null : now,
    g.background?.trim() || null,
  );
  return getGoal(db, id) as Goal;
}

export function updateGoal(db: Database, id: string, patch: Partial<GoalInput> & { status?: Goal['status'] }): void {
  const current = getGoal(db, id);
  if (!current) return;
  const next = { ...current, ...patch };
  db.prepare('UPDATE goals SET text = ?, kind = ?, assessment = ?, target_grade = ?, date = ?, budget = ?, focus = ?, priority = ?, status = ?, background = ? WHERE id = ?').run(
    next.text,
    next.kind,
    next.assessment,
    next.targetGrade,
    next.date,
    next.budget ? JSON.stringify(next.budget) : null,
    JSON.stringify(next.focus),
    next.priority,
    next.status,
    next.background?.trim() || null,
    id,
  );
}

/** The learner approved the plan: the draft becomes active and its clock starts. */
export function approveGoal(db: Database, id: string): void {
  db.prepare("UPDATE goals SET status = 'active', approved_at = COALESCE(approved_at, ?) WHERE id = ?").run(nowIso(), id);
}

export function saveCoverage(db: Database, id: string, coverage: Coverage): void {
  db.prepare('UPDATE goals SET coverage = ? WHERE id = ?').run(coverage, id);
}

/** Record the depth of ideas that just joined the goal; ideas already in the baseline keep theirs. */
export function extendBaseline(db: Database, id: string, depths: Record<string, Depth>): void {
  const goal = getGoal(db, id);
  if (!goal) return;
  const next = { ...depths, ...goal.baseline };
  if (Object.keys(next).length === Object.keys(goal.baseline).length) return;
  db.prepare('UPDATE goals SET baseline = ? WHERE id = ?').run(JSON.stringify(next), id);
}

/** Write the plan's depth for each target, keyed `${capabilityId}|${nodeId}`. */
export function savePlannedDepths(db: Database, planned: Map<string, Depth>): void {
  const stmt = db.prepare('UPDATE targets SET planned_depth = ? WHERE capability_id = ? AND node_id = ? AND (planned_depth IS NOT ? )');
  for (const [key, depth] of planned) {
    const [capabilityId, nodeId] = key.split('|');
    stmt.run(depth, capabilityId as string, nodeId as string, depth);
  }
}

export function deleteGoal(db: Database, id: string): void {
  db.prepare('DELETE FROM goals WHERE id = ?').run(id);
}

export function getGoal(db: Database, id: string): Goal | undefined {
  const row = db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as GoalRow | undefined;
  return row ? toGoal(row) : undefined;
}

export function listGoals(db: Database): Goal[] {
  return (db.prepare('SELECT * FROM goals ORDER BY created_at').all() as unknown as GoalRow[]).map(toGoal);
}

/** Record a compile: the goal's short title, which teaching sources it covered, and what the goal means for its time. */
export function markCompiled(db: Database, goalId: string, title: string | null, sourceIds: string[], reading: { level?: GoalLevel | null; scope?: string | null } = {}): void {
  db.prepare('UPDATE goals SET compiled_at = ?, title = COALESCE(?, title), compiled_sources = ?, level = COALESCE(?, level), scope = COALESCE(?, scope) WHERE id = ?').run(
    nowIso(),
    title,
    JSON.stringify(sourceIds),
    reading.level ?? null,
    reading.scope ?? null,
    goalId,
  );
}

export function saveProfile(db: Database, goalId: string, profile: ExamProfile | null, plan: UpcomingUnit[], sourceIds: string[]): void {
  db.prepare('UPDATE goals SET exam_profile = ?, course_plan = ?, profile_sources = ? WHERE id = ?').run(profile ? JSON.stringify(profile) : null, JSON.stringify(plan), JSON.stringify(sourceIds), goalId);
}

export function saveGaps(db: Database, goalId: string, gaps: BackgroundGap[]): void {
  db.prepare('UPDATE goals SET gaps = ? WHERE id = ?').run(JSON.stringify(gaps), goalId);
}

export function saveRemap(db: Database, goalId: string, remap: GoalRemap | null): void {
  db.prepare('UPDATE goals SET remap = ? WHERE id = ?').run(remap ? JSON.stringify(remap) : null, goalId);
}

export function startUnverified(db: Database, goalId: string, nodeId: string): void {
  const goal = getGoal(db, goalId);
  if (!goal || goal.startedUnverified.includes(nodeId)) return;
  db.prepare('UPDATE goals SET started_unverified = ? WHERE id = ?').run(JSON.stringify([...goal.startedUnverified, nodeId]), goalId);
}

/** Replace a goal's material list (sources and their roles), keeping when each was first added. */
export function setMaterials(db: Database, goalId: string, materials: { sourceId: string; role: MaterialRole }[]): void {
  const existing = new Map(listMaterials(db, goalId).map((m) => [m.sourceId, m.addedAt]));
  db.prepare('DELETE FROM goal_materials WHERE goal_id = ?').run(goalId);
  const insert = db.prepare('INSERT INTO goal_materials (goal_id, source_id, role, added_at) VALUES (?, ?, ?, ?)');
  const now = nowIso();
  for (const m of materials) insert.run(goalId, m.sourceId, m.role, existing.get(m.sourceId) ?? now);
}

export function listMaterials(db: Database, goalId: string): GoalMaterial[] {
  return (db.prepare('SELECT source_id, role, added_at FROM goal_materials WHERE goal_id = ? ORDER BY added_at, rowid').all(goalId) as { source_id: string; role: MaterialRole; added_at: string }[]).map((r) => ({
    sourceId: r.source_id,
    role: r.role,
    addedAt: r.added_at,
  }));
}

/** Every role a source plays across goals. */
export function rolesOfSource(db: Database, sourceId: string): { goalId: string; role: MaterialRole }[] {
  return (db.prepare('SELECT goal_id, role FROM goal_materials WHERE source_id = ?').all(sourceId) as { goal_id: string; role: MaterialRole }[]).map((r) => ({ goalId: r.goal_id, role: r.role }));
}

export interface NewTarget {
  nodeId: string;
  depth: Depth;
  core?: boolean;
}

/** Add capabilities after the existing ones, with their targets. */
export function addCapabilities(db: Database, goalId: string, capabilities: { statement: string; targets: NewTarget[] }[]): Capability[] {
  const start = (db.prepare('SELECT COALESCE(MAX(ord) + 1, 0) AS n FROM capabilities WHERE goal_id = ?').get(goalId) as { n: number }).n;
  const insertCap = db.prepare('INSERT INTO capabilities (id, goal_id, statement, ord, mastered_at) VALUES (?, ?, ?, ?, NULL)');
  const out: Capability[] = [];
  capabilities.forEach((cap, i) => {
    const id = newId('cap');
    insertCap.run(id, goalId, cap.statement, start + i);
    addTargets(db, id, cap.targets);
    out.push({ id, goalId, statement: cap.statement, order: start + i, masteredAt: null });
  });
  return out;
}

/** Add targets to an existing capability; an existing target keeps the deeper of the two depths and stays core once core. */
export function addTargets(db: Database, capabilityId: string, targets: NewTarget[]): void {
  const upsert = db.prepare(
    'INSERT INTO targets (capability_id, node_id, depth, core) VALUES (?, ?, ?, ?) ON CONFLICT(capability_id, node_id) DO UPDATE SET depth = MAX(depth, excluded.depth), core = MAX(core, excluded.core)',
  );
  for (const t of targets) upsert.run(capabilityId, t.nodeId, t.depth, t.core ? 1 : 0);
}

/**
 * The learner approved the plan as it stands (approving a draft, changing the time, a new map): every
 * target of the goal not yet capped keeps its planned depth as the most automatic re-plans may give it.
 */
export function approvePlannedDepths(db: Database, goalId: string): void {
  db.prepare('UPDATE targets SET approved_depth = COALESCE(planned_depth, depth) WHERE approved_depth IS NULL AND capability_id IN (SELECT id FROM capabilities WHERE goal_id = ?)').run(goalId);
}

/** Lift the caps before the plan is approved again (a new time re-plans from the ideal depths). Simplified ideas keep theirs. */
export function clearApprovedDepths(db: Database, goalId: string): void {
  db.prepare('UPDATE targets SET approved_depth = NULL WHERE simplified IS NULL AND capability_id IN (SELECT id FROM capabilities WHERE goal_id = ?)').run(goalId);
}

/** Simplify an idea for a goal: cap its targets at `depth` and say why (the first reason stays). */
export function capTargets(db: Database, goalId: string, nodeId: string, depth: Depth, reason: string): void {
  db.prepare(
    'UPDATE targets SET approved_depth = MIN(COALESCE(approved_depth, depth), ?), simplified = COALESCE(simplified, ?) WHERE node_id = ? AND capability_id IN (SELECT id FROM capabilities WHERE goal_id = ?)',
  ).run(depth, reason, nodeId, goalId);
}

export function deleteCapabilities(db: Database, ids: string[]): void {
  const stmt = db.prepare('DELETE FROM capabilities WHERE id = ?');
  for (const id of ids) stmt.run(id);
}

export function listCapabilities(db: Database, goalId?: string): Capability[] {
  const rows = goalId
    ? (db.prepare('SELECT * FROM capabilities WHERE goal_id = ? ORDER BY ord').all(goalId) as unknown as CapabilityRow[])
    : (db.prepare('SELECT * FROM capabilities ORDER BY goal_id, ord').all() as unknown as CapabilityRow[]);
  return rows.map(toCapability);
}

/**
 * The targets the plan holds: depth is the planned depth, and targets the budget leaves out are
 * skipped. `all` lists every target at its planned depth, left-out ones included (depth 0).
 */
export function listTargets(db: Database, goalId?: string, options: { all?: boolean } = {}): Target[] {
  const rows = goalId
    ? (db.prepare('SELECT t.* FROM targets t JOIN capabilities c ON c.id = t.capability_id WHERE c.goal_id = ?').all(goalId) as unknown as TargetRow[])
    : (db.prepare('SELECT * FROM targets').all() as unknown as TargetRow[]);
  const targets = rows.map(toTarget);
  return options.all ? targets : targets.filter((t) => t.depth > 0);
}

export function markCapabilityMastered(db: Database, capabilityId: string): void {
  db.prepare('UPDATE capabilities SET mastered_at = ? WHERE id = ?').run(nowIso(), capabilityId);
}
