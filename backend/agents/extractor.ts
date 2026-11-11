import { z } from 'zod';
import { estimateTokens } from '../ingest/chunker';
import type { LlmProvider } from '../llm/provider';
import { loadPrompt } from './prompts';

const TEMP_ID = /^n\d{1,3}$/;

export const ExtractedNodeSchema = z.object({
  tempId: z.string().regex(TEMP_ID, 'tempId must look like n1, n2, ...'),
  kind: z.enum(['claim', 'procedure', 'term']),
  name: z.string().trim().min(2).max(120),
  statement: z.string().trim().min(5).max(1200),
  aliases: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  locator: z.string().trim().max(80).optional(),
});

export const ExtractedChainSchema = z.object({
  premises: z.array(z.string().trim().min(1)).min(1).max(8),
  conclusion: z.string().trim().min(1),
  locator: z.string().trim().max(80).optional(),
});

export const ExtractedExampleSchema = z.object({
  illustrates: z.string().trim().min(1),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(4000),
  locator: z.string().trim().max(80).optional(),
});

export const ConflictSchema = z.object({
  nodeId: z.string().trim().min(1),
  description: z.string().trim().min(3).max(400),
});

export type Extraction = {
  nodes: z.infer<typeof ExtractedNodeSchema>[];
  chains: z.infer<typeof ExtractedChainSchema>[];
  examples: z.infer<typeof ExtractedExampleSchema>[];
  conflicts: z.infer<typeof ConflictSchema>[];
};

/** Hard cap per call; the range below is what the extractor is asked for. */
const MAX_IDEAS = 40;
/** Teaching text per idea: an idea is about half an hour of learning, roughly one section of a paper. */
const TOKENS_PER_IDEA = { most: 1250, fewest: 1700 };

/**
 * How many ideas to ask for from a text of this length: a 15-page paper (about 10,000 tokens) gives
 * 6–8, a short article 2–3, an 80-page part of a book about 24–32. Pure.
 */
export function ideaRange(text: string): { min: number; max: number } {
  const tokens = estimateTokens(text);
  const min = Math.min(MAX_IDEAS, Math.max(1, Math.round(tokens / TOKENS_PER_IDEA.fewest)));
  const max = Math.min(MAX_IDEAS, Math.max(min + 1, Math.round(tokens / TOKENS_PER_IDEA.most)));
  return { min, max };
}

/** The schema is built per call so chain references are checked against the ids the model was given. */
export function buildExtractionSchema(knownIds: Set<string>) {
  return z
    .object({
      nodes: z.array(ExtractedNodeSchema).max(MAX_IDEAS),
      chains: z.array(ExtractedChainSchema).max(80).default([]),
      examples: z.array(ExtractedExampleSchema).max(20).default([]),
      conflicts: z.array(ConflictSchema).max(20).default([]),
    })
    .superRefine((value, ctx) => {
      const tempIds = new Set<string>();
      value.nodes.forEach((n, i) => {
        if (tempIds.has(n.tempId)) ctx.addIssue({ code: 'custom', path: ['nodes', i, 'tempId'], message: `duplicate tempId ${n.tempId}` });
        tempIds.add(n.tempId);
      });
      const valid = (id: string) => tempIds.has(id) || knownIds.has(id);
      value.chains.forEach((c, i) => {
        if (!valid(c.conclusion)) ctx.addIssue({ code: 'custom', path: ['chains', i, 'conclusion'], message: `unknown id ${c.conclusion}; use a tempId from nodes or an id from the graph so far` });
        c.premises.forEach((p, j) => {
          if (!valid(p)) ctx.addIssue({ code: 'custom', path: ['chains', i, 'premises', j], message: `unknown id ${p}` });
          if (p === c.conclusion) ctx.addIssue({ code: 'custom', path: ['chains', i, 'premises', j], message: 'a chain cannot have its conclusion as a premise' });
        });
      });
      const loop = chainLoop(value.chains);
      if (loop) ctx.addIssue({ code: 'custom', path: ['chains'], message: `the chains go in a circle (${loop.join(' → ')}); an idea cannot be a prerequisite of what it needs` });
      value.examples.forEach((e, i) => {
        if (!valid(e.illustrates)) ctx.addIssue({ code: 'custom', path: ['examples', i, 'illustrates'], message: `unknown id ${e.illustrates}; an example must illustrate a node from this part or the graph so far` });
      });
      value.conflicts.forEach((k, i) => {
        if (!knownIds.has(k.nodeId)) ctx.addIssue({ code: 'custom', path: ['conflicts', i, 'nodeId'], message: `conflicts must name an id from the graph so far` });
      });
    });
}

/** A circle of prerequisites in the submitted chains (premise → conclusion), or null. */
export function chainLoop(chains: { premises: string[]; conclusion: string }[]): string[] | null {
  const next = new Map<string, string[]>();
  for (const c of chains) for (const p of c.premises) next.set(p, [...(next.get(p) ?? []), c.conclusion]);
  const state = new Map<string, 'open' | 'done'>();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 'done') return null;
    if (state.get(id) === 'open') return [...path.slice(path.indexOf(id)), id];
    state.set(id, 'open');
    path.push(id);
    for (const to of next.get(id) ?? []) {
      const found = visit(to);
      if (found) return found;
    }
    path.pop();
    state.set(id, 'done');
    return null;
  };
  for (const id of next.keys()) {
    const found = visit(id);
    if (found) return found;
  }
  return null;
}

export interface DigestEntry {
  id: string;
  kind: string;
  name: string;
  statement: string;
}

export interface ExtractorInput {
  sourceTitle: string;
  sourceKind: string;
  locator: string;
  chunkIndex: number;
  chunkCount: number;
  text: string;
  digest: DigestEntry[];
}

export function formatDigest(digest: DigestEntry[]): string {
  if (digest.length === 0) return '(nothing yet)';
  return digest.map((d) => `- [${d.id}] ${d.name} (${d.kind}): ${truncate(d.statement, 200)}`).join('\n');
}

export async function runExtractor(provider: LlmProvider, input: ExtractorInput, signal?: AbortSignal): Promise<Extraction> {
  const knownIds = new Set(input.digest.map((d) => d.id));
  const range = ideaRange(input.text);
  const message = [
    `Source: "${input.sourceTitle}" (${input.sourceKind}). ${input.chunkCount === 1 ? 'The whole source' : `Part ${input.chunkIndex + 1} of ${input.chunkCount}`}, ${input.locator}.`,
    `Aim for ${range.min}–${range.max} ideas${input.chunkCount === 1 ? '' : ' in this part'}; fewer when the text is thin or mostly references, results or logistics.`,
    '',
    '## Graph so far (ids verbatim)',
    formatDigest(input.digest),
    '',
    '## Text',
    input.text,
  ].join('\n');
  const result = await provider.complete({
    role: 'extractor',
    system: loadPrompt('extractor'),
    messages: [{ role: 'user', content: message }],
    submit: { name: 'submit_extraction', description: 'Submit the ideas, chains, worked examples and conflicts found in this text.', schema: buildExtractionSchema(knownIds) },
    signal,
  });
  return result.data;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
