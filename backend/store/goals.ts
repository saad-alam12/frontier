import type { Database } from './db';
import { nowIso, parseJson } from './db';
import { newId } from './ids';
import type { Assessment, Capability, Depth, ExamProfile, Goal, GoalKind, GoalMaterial, MaterialRole, Target, UpcomingUnit } from '../core/types';

interface GoalRow {
  id: string;
  text: string;
  title: string | null;
  kind: GoalKind;
  assessment: Assessment;
  target_grade: string | null;
  date: string | null;
  hours_per_week: number | null;
  priority: number;
  status: Goal['status'];
  created_at: string;
  compiled_at: string | null;
  compiled_sources: string;
  exam_profile: string | null;
  course_plan: string;
  profile_sources: string;
  started_unverified: string;
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
}

const toGoal = (r: GoalRow): Goal => ({
  id: r.id,
  text: r.text,
  title: r.title,
  kind: r.kind,
  assessment: r.assessment,
  targetGrade: r.target_grade,
  date: r.date,
  hoursPerWeek: r.hours_per_week,
  priority: r.priority,
  status: r.status,
  createdAt: r.created_at,
  compiledAt: r.compiled_at,
  compiledSources: parseJson<string[]>(r.compiled_sources, []),
  examProfile: parseJson<ExamProfile | null>(r.exam_profile, null),
  coursePlan: parseJson<UpcomingUnit[]>(r.course_plan, []),
  profileSources: parseJson<string[]>(r.profile_sources, []),
  startedUnverified: parseJson<string[]>(r.started_unverified, []),
});
const toCapability = (r: CapabilityRow): Capability => ({ id: r.id, goalId: r.goal_id, statement: r.statement, order: r.ord, masteredAt: r.mastered_at });
const toTarget = (r: TargetRow): Target => ({ capabilityId: r.capability_id, nodeId: r.node_id, depth: r.depth as Depth });

/** What the learner states about a goal; everything else is derived. */
export interface GoalInput {
  text: string;
  kind?: GoalKind;
  assessment?: Assessment;
  targetGrade?: string | null;
  date?: string | null;
  hoursPerWeek?: number | null;
  priority?: number;
}

export function createGoal(db: Database, input: GoalInput | string, priority = 1): Goal {
  const g: GoalInput = typeof input === 'string' ? { text: input, priority } : input;
  const id = newId('goal');
  db.prepare(
    'INSERT INTO goals (id, text, kind, assessment, target_grade, date, hours_per_week, priority, status, created_at, compiled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)',
  ).run(id, g.text, g.kind ?? 'personal', g.assessment ?? 'none', g.targetGrade ?? null, g.date ?? null, g.hoursPerWeek ?? null, g.priority ?? 1, 'active', nowIso());
  return getGoal(db, id) as Goal;
}

export function updateGoal(db: Database, id: string, patch: Partial<GoalInput> & { status?: Goal['status'] }): void {
  const current = getGoal(db, id);
  if (!current) return;
  const next = { ...current, ...patch };
  db.prepare('UPDATE goals SET text = ?, kind = ?, assessment = ?, target_grade = ?, date = ?, hours_per_week = ?, priority = ?, status = ? WHERE id = ?').run(
    next.text,
    next.kind,
    next.assessment,
    next.targetGrade,
    next.date,
    next.hoursPerWeek,
    next.priority,
    next.status,
    id,
  );
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

/** Record a compile: the goal's short title and which teaching sources it covered. */
export function markCompiled(db: Database, goalId: string, title: string | null, sourceIds: string[]): void {
  db.prepare('UPDATE goals SET compiled_at = ?, title = COALESCE(?, title), compiled_sources = ? WHERE id = ?').run(nowIso(), title, JSON.stringify(sourceIds), goalId);
}

export function saveProfile(db: Database, goalId: string, profile: ExamProfile | null, plan: UpcomingUnit[], sourceIds: string[]): void {
  db.prepare('UPDATE goals SET exam_profile = ?, course_plan = ?, profile_sources = ? WHERE id = ?').run(profile ? JSON.stringify(profile) : null, JSON.stringify(plan), JSON.stringify(sourceIds), goalId);
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

/** Add capabilities after the existing ones, with their targets. */
export function addCapabilities(db: Database, goalId: string, capabilities: { statement: string; targets: { nodeId: string; depth: Depth }[] }[]): Capability[] {
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

/** Add targets to an existing capability; an existing target keeps the deeper of the two depths. */
export function addTargets(db: Database, capabilityId: string, targets: { nodeId: string; depth: Depth }[]): void {
  const upsert = db.prepare('INSERT INTO targets (capability_id, node_id, depth) VALUES (?, ?, ?) ON CONFLICT(capability_id, node_id) DO UPDATE SET depth = MAX(depth, excluded.depth)');
  for (const t of targets) upsert.run(capabilityId, t.nodeId, t.depth);
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

export function listTargets(db: Database, goalId?: string): Target[] {
  const rows = goalId
    ? (db.prepare('SELECT t.* FROM targets t JOIN capabilities c ON c.id = t.capability_id WHERE c.goal_id = ?').all(goalId) as unknown as TargetRow[])
    : (db.prepare('SELECT * FROM targets').all() as unknown as TargetRow[]);
  return rows.map(toTarget);
}

export function markCapabilityMastered(db: Database, capabilityId: string): void {
  db.prepare('UPDATE capabilities SET mastered_at = ? WHERE id = ?').run(nowIso(), capabilityId);
}
