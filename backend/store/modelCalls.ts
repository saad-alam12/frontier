/** Model calls as they answered: the job, the model and the tokens, for the usage line in Settings. */
import type { Database } from './db';
import { nowIso } from './db';

export interface ModelCallRecord {
  role: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
}

export function recordModelCall(db: Database, call: ModelCallRecord, at = nowIso()): void {
  db.prepare('INSERT INTO model_calls (at, role, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    at,
    call.role,
    call.model,
    call.inputTokens,
    call.outputTokens,
    call.cacheReadTokens,
    call.cacheWriteTokens,
    call.costUsd,
  );
}

export interface CallTotals {
  calls: number;
  /** Input tokens, cache reads and writes included. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/** Calls since `since` (ISO), in all and per job. */
export function callTotals(db: Database, since: string): { all: CallTotals; byRole: (CallTotals & { role: string })[] } {
  const rows = db
    .prepare(
      `SELECT role, count(*) AS calls, sum(input_tokens + cache_read_tokens + cache_write_tokens) AS input, sum(output_tokens) AS output, sum(cache_read_tokens) AS cached
       FROM model_calls WHERE at >= ? GROUP BY role ORDER BY sum(input_tokens + cache_read_tokens + cache_write_tokens + output_tokens) DESC`,
    )
    .all(since) as { role: string; calls: number; input: number; output: number; cached: number }[];
  const byRole = rows.map((r) => ({ role: r.role, calls: r.calls, inputTokens: r.input, outputTokens: r.output, cacheReadTokens: r.cached }));
  const all = byRole.reduce((sum, r) => ({ calls: sum.calls + r.calls, inputTokens: sum.inputTokens + r.inputTokens, outputTokens: sum.outputTokens + r.outputTokens, cacheReadTokens: sum.cacheReadTokens + r.cacheReadTokens }), { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
  return { all, byRole };
}
