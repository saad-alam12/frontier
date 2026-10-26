import type { Database } from './db';
import { nowIso } from './db';
import { newId } from './ids';
import type { Capability, Depth, Goal, Target } from '../core/types';

interface GoalRow {
  id: string;
  text: string;
  priority: number;
  status: Goal['status'];
  created_at: string;
  compiled_at: string | null;
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

const toGoal = (r: GoalRow): Goal => ({ id: r.id, text: r.text, priority: r.priority, status: r.status, createdAt: r.created_at, compiledAt: r.compiled_at });
const toCapability = (r: CapabilityRow): Capability => ({ id: r.id, goalId: r.goal_id, statement: r.statement, order: r.ord, masteredAt: r.mastered_at });
const toTarget = (r: TargetRow): Target => ({ capabilityId: r.capability_id, nodeId: r.node_id, depth: r.depth as Depth });

export function createGoal(db: Database, text: string, priority = 1): Goal {
  const goal: Goal = { id: newId('goal'), text, priority, status: 'active', createdAt: nowIso(), compiledAt: null };
  db.prepare('INSERT INTO goals (id, text, priority, status, created_at, compiled_at) VALUES (?, ?, ?, ?, ?, NULL)').run(
    goal.id,
    goal.text,
    goal.priority,
    goal.status,
    goal.createdAt,
  );
  return goal;
}

export function updateGoal(db: Database, id: string, patch: Partial<Pick<Goal, 'text' | 'priority' | 'status'>>): void {
  const current = getGoal(db, id);
  if (!current) return;
  const next = { ...current, ...patch };
  db.prepare('UPDATE goals SET text = ?, priority = ?, status = ? WHERE id = ?').run(next.text, next.priority, next.status, id);
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

/** Replace a goal's capabilities and targets with a fresh compile. */
export function saveCompile(db: Database, goalId: string, capabilities: { statement: string; targets: { nodeId: string; depth: Depth }[] }[]): Capability[] {
  db.prepare('DELETE FROM capabilities WHERE goal_id = ?').run(goalId);
  const insertCap = db.prepare('INSERT INTO capabilities (id, goal_id, statement, ord, mastered_at) VALUES (?, ?, ?, ?, NULL)');
  const insertTarget = db.prepare('INSERT OR REPLACE INTO targets (capability_id, node_id, depth) VALUES (?, ?, ?)');
  const out: Capability[] = [];
  capabilities.forEach((cap, i) => {
    const id = newId('cap');
    insertCap.run(id, goalId, cap.statement, i);
    for (const t of cap.targets) insertTarget.run(id, t.nodeId, t.depth);
    out.push({ id, goalId, statement: cap.statement, order: i, masteredAt: null });
  });
  db.prepare('UPDATE goals SET compiled_at = ? WHERE id = ?').run(nowIso(), goalId);
  return out;
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
