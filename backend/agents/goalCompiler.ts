import { z } from 'zod';
import type { LlmProvider } from '../llm/provider';
import { loadPrompt } from './prompts';

const DepthSchema = z.number().int().min(1).max(5);

export interface GraphSummaryEntry {
  id: string;
  kind: string;
  name: string;
  statement: string;
}

export function buildCompileSchema(knownIds: Set<string>) {
  return z
    .object({
      capabilities: z
        .array(
          z.object({
            statement: z.string().trim().min(10).max(300),
            targets: z.array(z.object({ ref: z.string().trim().min(1), depth: DepthSchema })).min(1).max(30),
          }),
        )
        .min(3)
        .max(15),
      newNodes: z
        .array(
          z.object({
            tempId: z.string().regex(/^m\d{1,3}$/, 'tempId must look like m1, m2, ...'),
            kind: z.enum(['claim', 'procedure', 'term']),
            name: z.string().trim().min(2).max(120),
            statement: z.string().trim().min(5).max(800),
          }),
        )
        .max(40)
        .default([]),
    })
    .superRefine((value, ctx) => {
      const temp = new Set<string>();
      value.newNodes.forEach((n, i) => {
        if (temp.has(n.tempId)) ctx.addIssue({ code: 'custom', path: ['newNodes', i, 'tempId'], message: `duplicate tempId ${n.tempId}` });
        temp.add(n.tempId);
      });
      value.capabilities.forEach((c, i) =>
        c.targets.forEach((t, j) => {
          if (!knownIds.has(t.ref) && !temp.has(t.ref)) {
            ctx.addIssue({ code: 'custom', path: ['capabilities', i, 'targets', j, 'ref'], message: `unknown id ${t.ref}; use an id from the graph or a tempId from newNodes` });
          }
        }),
      );
    });
}

export type CompileResult = z.infer<ReturnType<typeof buildCompileSchema>>;

export interface GoalCompilerInput {
  goalText: string;
  priority: number;
  graph: GraphSummaryEntry[];
  /** True when the graph list was cut down to the most relevant nodes. */
  truncated: boolean;
}

export async function runGoalCompiler(provider: LlmProvider, input: GoalCompilerInput): Promise<CompileResult> {
  const knownIds = new Set(input.graph.map((g) => g.id));
  const graphText = input.graph.length
    ? input.graph.map((g) => `- [${g.id}] ${g.name} (${g.kind}): ${truncate(g.statement, 160)}`).join('\n')
    : '(the graph is empty; every target will be a new node)';
  const message = [
    `## Goal\n${input.goalText}\n\nPriority: ${input.priority}`,
    `## Knowledge graph${input.truncated ? ' (most relevant nodes only)' : ''}\n${graphText}`,
  ].join('\n\n');
  const result = await provider.complete({
    role: 'goalCompiler',
    system: loadPrompt('goal-compiler'),
    messages: [{ role: 'user', content: message }],
    submit: { name: 'submit_compile', description: 'Submit the capabilities, their target nodes with depths, and any new nodes.', schema: buildCompileSchema(knownIds) },
  });
  return result.data;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
