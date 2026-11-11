import { z } from 'zod';
import type { LlmProvider } from '../llm/provider';
import { loadPrompt } from './prompts';

export interface MatchCandidate {
  id: string;
  kind: string;
  name: string;
  statement: string;
  score: number;
}

export interface MatchQuery {
  tempId: string;
  kind: string;
  name: string;
  statement: string;
  candidates: MatchCandidate[];
}

export interface MatchDecision {
  tempId: string;
  match: string | null;
  confidence: number;
  reasoning: string;
}

export function buildMatchSchema(queries: MatchQuery[]) {
  const allowed = new Map(queries.map((q) => [q.tempId, new Set(q.candidates.map((c) => c.id))]));
  return z
    .object({
      decisions: z
        .array(
          z.object({
            tempId: z.string(),
            match: z.string().nullable(),
            confidence: z.number().min(0).max(1),
            reasoning: z.string().max(400).default(''),
          }),
        )
        .min(1),
    })
    .superRefine((value, ctx) => {
      const seen = new Set<string>();
      value.decisions.forEach((d, i) => {
        const candidates = allowed.get(d.tempId);
        if (!candidates) ctx.addIssue({ code: 'custom', path: ['decisions', i, 'tempId'], message: `unknown tempId ${d.tempId}` });
        else if (d.match !== null && !candidates.has(d.match)) ctx.addIssue({ code: 'custom', path: ['decisions', i, 'match'], message: `${d.match} is not a candidate for ${d.tempId}` });
        seen.add(d.tempId);
      });
      for (const q of queries) if (!seen.has(q.tempId)) ctx.addIssue({ code: 'custom', path: ['decisions'], message: `missing a decision for ${q.tempId}` });
    });
}

export function formatMatchQueries(queries: MatchQuery[]): string {
  return queries
    .map((q) => {
      const cands = q.candidates.map((c) => `  - [${c.id}] ${c.name} (${c.kind}): ${c.statement}`).join('\n');
      return `### ${q.tempId}: ${q.name} (${q.kind})\n${q.statement}\nCandidates:\n${cands}`;
    })
    .join('\n\n');
}

/** Returns one decision per query; queries with no candidates are decided as new without a model call. */
export async function runMatcher(provider: LlmProvider, queries: MatchQuery[], signal?: AbortSignal): Promise<MatchDecision[]> {
  const askable = queries.filter((q) => q.candidates.length > 0);
  const decisions: MatchDecision[] = queries.filter((q) => q.candidates.length === 0).map((q) => ({ tempId: q.tempId, match: null, confidence: 1, reasoning: 'no candidates' }));
  if (askable.length === 0) return decisions;
  const result = await provider.complete({
    role: 'matcher',
    system: loadPrompt('matcher'),
    messages: [{ role: 'user', content: `Decide identity for each new node.\n\n${formatMatchQueries(askable)}` }],
    submit: { name: 'submit_matches', description: 'Submit one identity decision per new node.', schema: buildMatchSchema(askable) },
    signal,
  });
  return [...decisions, ...result.data.decisions];
}
