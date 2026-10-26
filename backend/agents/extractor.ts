import { z } from 'zod';
import type { LlmProvider } from '../llm/provider';
import { loadPrompt } from './prompts';

const TEMP_ID = /^n\d{1,3}$/;

export const ExtractedNodeSchema = z.object({
  tempId: z.string().regex(TEMP_ID, 'tempId must look like n1, n2, ...'),
  kind: z.enum(['claim', 'procedure', 'term']),
  name: z.string().trim().min(2).max(120),
  statement: z.string().trim().min(5).max(800),
  aliases: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  locator: z.string().trim().max(80).optional(),
});

export const ExtractedChainSchema = z.object({
  premises: z.array(z.string().trim().min(1)).min(1).max(8),
  conclusion: z.string().trim().min(1),
  locator: z.string().trim().max(80).optional(),
});

export const ConflictSchema = z.object({
  nodeId: z.string().trim().min(1),
  description: z.string().trim().min(3).max(400),
});

export type Extraction = {
  nodes: z.infer<typeof ExtractedNodeSchema>[];
  chains: z.infer<typeof ExtractedChainSchema>[];
  conflicts: z.infer<typeof ConflictSchema>[];
};

/** The schema is built per call so chain references are checked against the ids the model was given. */
export function buildExtractionSchema(knownIds: Set<string>) {
  return z
    .object({
      nodes: z.array(ExtractedNodeSchema).max(40),
      chains: z.array(ExtractedChainSchema).max(80).default([]),
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
      value.conflicts.forEach((k, i) => {
        if (!knownIds.has(k.nodeId)) ctx.addIssue({ code: 'custom', path: ['conflicts', i, 'nodeId'], message: `conflicts must name an id from the graph so far` });
      });
    });
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
  if (digest.length === 0) return '(nothing yet; this is the first chunk)';
  return digest.map((d) => `- [${d.id}] ${d.name} (${d.kind}): ${truncate(d.statement, 200)}`).join('\n');
}

export async function runExtractor(provider: LlmProvider, input: ExtractorInput): Promise<Extraction> {
  const knownIds = new Set(input.digest.map((d) => d.id));
  const message = [
    `Source: "${input.sourceTitle}" (${input.sourceKind}). Chunk ${input.chunkIndex + 1} of ${input.chunkCount}, location: ${input.locator}.`,
    '',
    '## Graph so far (ids verbatim)',
    formatDigest(input.digest),
    '',
    '## Chunk text',
    input.text,
  ].join('\n');
  const result = await provider.complete({
    role: 'extractor',
    system: loadPrompt('extractor'),
    messages: [{ role: 'user', content: message }],
    submit: { name: 'submit_extraction', description: 'Submit the nodes, chains and conflicts found in this chunk.', schema: buildExtractionSchema(knownIds) },
  });
  return result.data;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
