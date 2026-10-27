import { z } from 'zod';
import type { LlmProvider } from '../llm/provider';
import { loadPrompt } from './prompts';

export interface PlannerCandidate {
  nodeId: string;
  kind: string;
  name: string;
  statement: string;
  tier: string;
  onFringe: boolean;
  layer: number;
  dependsOn: string[];
  unlocksTargets: number;
  targetDepth: number;
  currentDepth: number;
}

export interface PlannerInput {
  goalText: string;
  /** The exam profile summary, when the goal has past exams. */
  examStyle: string | null;
  capabilities: string[];
  targets: { nodeId: string; name: string; targetDepth: number; currentDepth: number }[];
  candidates: PlannerCandidate[];
  ownedNames: string[];
  maxNodes: number;
}

export function buildPlanSchema(candidateIds: Set<string>, maxNodes: number) {
  return z
    .object({
      title: z.string().trim().min(2).max(80),
      orientation: z.string().trim().min(10).max(400),
      steps: z.array(z.object({ nodeId: z.string().min(1), why: z.string().trim().min(5).max(300) })).min(1).max(maxNodes),
    })
    .superRefine((value, ctx) => {
      const seen = new Set<string>();
      value.steps.forEach((s, i) => {
        if (!candidateIds.has(s.nodeId)) ctx.addIssue({ code: 'custom', path: ['steps', i, 'nodeId'], message: `${s.nodeId} is not a candidate for this session` });
        if (seen.has(s.nodeId)) ctx.addIssue({ code: 'custom', path: ['steps', i, 'nodeId'], message: `${s.nodeId} appears twice` });
        seen.add(s.nodeId);
      });
    });
}

export type PlanResult = z.infer<ReturnType<typeof buildPlanSchema>>;

export async function runPlanner(provider: LlmProvider, input: PlannerInput): Promise<PlanResult> {
  const candidates = input.candidates
    .map(
      (c) =>
        `- [${c.nodeId}] ${c.name} (${c.kind}, ${c.tier}${c.onFringe ? ', on the fringe now' : `, layer ${c.layer}`}) — unlocks ${c.unlocksTargets} target${c.unlocksTargets === 1 ? '' : 's'}; depth ${c.currentDepth} → ${c.targetDepth}\n  ${c.statement}${c.dependsOn.length ? `\n  after: ${c.dependsOn.join(', ')}` : ''}`,
    )
    .join('\n');
  const targets = input.targets.map((t) => `- [${t.nodeId}] ${t.name}: depth ${t.currentDepth} → ${t.targetDepth}`).join('\n');
  const message = [
    `## Goal\n${input.goalText}${input.examStyle ? `\n\nExam style: ${input.examStyle}` : ''}`,
    `## Capabilities\n${input.capabilities.map((c) => `- ${c}`).join('\n')}`,
    `## Targets\n${targets || '(none)'}`,
    `## Owned already\n${input.ownedNames.length ? input.ownedNames.join('; ') : '(nothing yet)'}`,
    `## Candidates for this session (pick at most ${input.maxNodes})\n${candidates}`,
  ].join('\n\n');
  const result = await provider.complete({
    role: 'planner',
    system: loadPrompt('planner'),
    messages: [{ role: 'user', content: message }],
    submit: { name: 'submit_plan', description: 'Submit the lesson plan for this session.', schema: buildPlanSchema(new Set(input.candidates.map((c) => c.nodeId)), input.maxNodes) },
  });
  return result.data;
}
