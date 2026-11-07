/**
 * The goal compiler's addition mode (design §3.2): the learner asks to add something to a goal in
 * their own words. The compiler judges whether it belongs to the goal, reads from the wording whether
 * it asks for breadth (how the goal relates to a whole field: several broad ideas) or depth (one aspect:
 * fewer, deeper ideas), and writes the new capabilities, targeting existing ideas where they exist.
 */
import { z } from 'zod';
import type { Assessment, GoalFocus, GoalLevel } from '../core/types';
import type { LlmProvider } from '../llm/provider';
import type { ExistingCapability, GraphSummaryEntry } from './goalCompiler';
import { ASSESSMENT_TEXT, FOCUS_TEXT, NewNodeSchema, TargetsSchema, checkTargetRefs, newNodeIds, truncate } from './goalCompiler';
import { loadPrompt } from './prompts';

/** An addition is a part of a goal, not a goal: a few skills at most. */
const MAX_SKILLS = 5;

export function buildAdditionSchema(knownIds: Set<string>) {
  return z
    .object({
      fits: z.boolean(),
      /** One sentence for the learner when it does not fit: why it is a goal of its own. */
      reason: z.string().trim().min(10).max(300).nullable().default(null),
      shape: z.enum(['broad', 'deep']),
      capabilities: z
        .array(z.object({ statement: z.string().trim().min(10).max(300), targets: TargetsSchema.min(1).max(12) }))
        .min(1)
        .max(MAX_SKILLS),
      newNodes: z.array(NewNodeSchema).max(20).default([]),
    })
    .superRefine((value, ctx) => {
      if (!value.fits && !value.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'say in one sentence why it does not belong to this goal' });
      const temp = newNodeIds(ctx, value.newNodes);
      value.capabilities.forEach((c, i) => checkTargetRefs(ctx, c.targets, ['capabilities', i, 'targets'], knownIds, temp));
      const used = new Set(value.capabilities.flatMap((c) => c.targets.map((t) => t.ref)));
      value.newNodes.forEach((n, i) => {
        if (!used.has(n.tempId)) ctx.addIssue({ code: 'custom', path: ['newNodes', i, 'tempId'], message: `${n.tempId} is not targeted by any capability` });
      });
    });
}

export type AdditionResult = z.infer<ReturnType<typeof buildAdditionSchema>>;

export interface AdditionInput {
  /** The learner's words: what else they want to learn here. */
  request: string;
  goal: {
    text: string;
    title: string | null;
    assessment: Assessment;
    focus: GoalFocus[];
    context: string | null;
    level: GoalLevel | null;
    scope: string | null;
    /** The goal's time in hours; null with no time limit (or no time given). */
    budgetHours: number | null;
    wantedLevel: GoalLevel | null;
  };
  existing: ExistingCapability[];
  /** The goal's ideas and the library's ideas that match the request. */
  graph: GraphSummaryEntry[];
}

export async function runGoalAddition(provider: LlmProvider, input: AdditionInput): Promise<AdditionResult> {
  const { goal } = input;
  const sections = [
    `## Goal\n${goal.text}${goal.title ? ` (“${goal.title}”)` : ''}\n\nAssessed by ${ASSESSMENT_TEXT[goal.assessment]}.`,
  ];
  if (goal.focus.length) sections.push(`## What the learner wants from it\n${goal.focus.map((f) => `- ${FOCUS_TEXT[f]}`).join('\n')}`);
  if (goal.level) sections.push(`## Level and scope\nThe goal is read at the \`${goal.level}\` level.${goal.scope ? ` ${goal.scope}` : ''}`);
  if (goal.context) sections.push(`## The learner's context\n${goal.context}`);
  sections.push(
    goal.wantedLevel
      ? '## Time\nThe goal has no time limit: what you add grows its estimate. Add what the request needs at the goal\'s level, and no more.'
      : goal.budgetHours !== null
        ? `## Time\nThe goal has a fixed time of about ${Math.round(goal.budgetHours)} hours, and adding does not change it: the plan makes room by giving other ideas less. So add only what the request needs; an idea learned in depth takes about half an hour.`
        : '## Time\nThe goal has no time set. Add what the request needs at the goal\'s level, and no more.',
  );
  sections.push(
    `## The current map\n${
      input.existing.length
        ? input.existing.map((c) => `- [${c.id}] ${c.statement}\n  targets: ${c.targets.map((t) => `${t.name} [${t.nodeId}] depth ${t.depth}`).join('; ')}`).join('\n')
        : '(empty)'
    }`,
  );
  sections.push(
    `## Ideas you may target (the goal's own, and the library's that match the request)\n${
      input.graph.length
        ? input.graph.map((g) => `- [${g.id}] ${g.name} (${g.kind}${g.elsewhere === 'known' ? ', the learner knows this' : g.elsewhere ? ', in another goal of the learner' : g.inMaterial ? ', in this goal' : ', in the library'}): ${truncate(g.statement, 160)}`).join('\n')
        : '(none)'
    }`,
  );
  sections.push(`## The learner's request\n“${input.request}”`);
  sections.push(
    '## Task\nAdd to the goal: judge `fits`, read `shape` from the wording, and write the new capabilities with their targets and any `newNodes`. Do not restate the current map; target its ideas only where the request takes them deeper.',
  );
  const knownIds = new Set(input.graph.map((g) => g.id));
  const result = await provider.complete({
    role: 'goalCompiler',
    system: loadPrompt('goal-compiler'),
    messages: [{ role: 'user', content: sections.join('\n\n') }],
    submit: {
      name: 'submit_addition',
      description: 'Submit whether the request fits the goal, its shape, the new capabilities with their targets, and any new nodes.',
      schema: buildAdditionSchema(knownIds),
    },
  });
  return result.data;
}
