import { z } from 'zod';
import type { Assessment, ExamProfile, GoalKind } from '../core/types';
import type { LlmProvider } from '../llm/provider';
import { loadPrompt } from './prompts';

const DepthSchema = z.number().int().min(1).max(5);
const TargetsSchema = z.array(z.object({ ref: z.string().trim().min(1), depth: DepthSchema }));

export interface GraphSummaryEntry {
  id: string;
  kind: string;
  name: string;
  statement: string;
  /** False for premises pulled in from outside the goal's material. */
  inMaterial: boolean;
}

export interface ExistingCapability {
  id: string;
  statement: string;
  mastered: boolean;
  targets: { nodeId: string; name: string; depth: number }[];
}

/**
 * Validated against the ids the compiler was shown. A first compile must define at least three
 * capabilities; a recompile only adds, extends or (rarely) retires.
 */
export function buildCompileSchema(knownIds: Set<string>, existingIds: Set<string>) {
  return z
    .object({
      title: z.string().trim().min(2).max(60),
      capabilities: z.array(z.object({ statement: z.string().trim().min(10).max(300), targets: TargetsSchema.min(1).max(30) })).max(15).default([]),
      extend: z.array(z.object({ capabilityId: z.string().trim().min(1), targets: TargetsSchema.min(1).max(30) })).max(15).default([]),
      retire: z.array(z.string().trim().min(1)).max(15).default([]),
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
      const checkRefs = (targets: { ref: string }[], path: (string | number)[]) =>
        targets.forEach((t, j) => {
          if (!knownIds.has(t.ref) && !temp.has(t.ref)) ctx.addIssue({ code: 'custom', path: [...path, j, 'ref'], message: `unknown id ${t.ref}; use an id from the graph or a tempId from newNodes` });
        });
      value.capabilities.forEach((c, i) => checkRefs(c.targets, ['capabilities', i, 'targets']));
      value.extend.forEach((e, i) => {
        if (!existingIds.has(e.capabilityId)) ctx.addIssue({ code: 'custom', path: ['extend', i, 'capabilityId'], message: `unknown capability ${e.capabilityId}` });
        checkRefs(e.targets, ['extend', i, 'targets']);
      });
      value.retire.forEach((id, i) => {
        if (!existingIds.has(id)) ctx.addIssue({ code: 'custom', path: ['retire', i], message: `unknown capability ${id}` });
      });
      if (existingIds.size === 0 && value.capabilities.length < 3) ctx.addIssue({ code: 'custom', path: ['capabilities'], message: 'a first compile needs at least 3 capabilities' });
    });
}

export type CompileResult = z.infer<ReturnType<typeof buildCompileSchema>>;

export interface GoalCompilerInput {
  goalText: string;
  kind: GoalKind;
  assessment: Assessment;
  targetGrade: string | null;
  date: string | null;
  examProfile: ExamProfile | null;
  /** The goal's own material's ideas plus the premises they are built on. */
  graph: GraphSummaryEntry[];
  /** True when the goal has no material: every target is a new, unverified node. */
  fromScratch: boolean;
  existing: ExistingCapability[];
  /** Titles of teaching sources added since the last compile. */
  newMaterial: string[];
}

const ASSESSMENT_TEXT: Record<Assessment, string> = {
  written_exam: 'a written exam',
  oral_exam: 'an oral exam',
  presentation_or_project: 'a presentation or project',
  outcome: 'a concrete outcome the learner wants to achieve',
  none: 'nothing; it is open-ended',
};

export async function runGoalCompiler(provider: LlmProvider, input: GoalCompilerInput): Promise<CompileResult> {
  const knownIds = new Set(input.graph.map((g) => g.id));
  const existingIds = new Set(input.existing.map((c) => c.id));
  const graphText = input.graph.length
    ? input.graph.map((g) => `- [${g.id}] ${g.name} (${g.kind}${g.inMaterial ? '' : ', premise from elsewhere'}): ${truncate(g.statement, 160)}`).join('\n')
    : input.fromScratch
      ? '(the learner has no material for this goal; build the roadmap from the goal itself, every target is a new node)'
      : '(no ideas extracted from the material yet)';
  const sections = [
    `## Goal\n${input.goalText}\n\nKind: ${input.kind === 'course' ? 'a course' : 'learning on their own'}. Assessed by ${ASSESSMENT_TEXT[input.assessment]}.${input.targetGrade ? ` Target grade: ${input.targetGrade}.` : ''}${input.date ? ` Date: ${input.date}.` : ''}`,
  ];
  if (input.examProfile) {
    const p = input.examProfile;
    sections.push(`## Exam profile (from past exams)\n${p.summary}\nFormat: ${p.format}. Duration: ${p.durationMinutes ?? 'unknown'} minutes. Aids: ${p.aids}. Question types: ${p.questionTypes.join('; ')}. Difficulty: ${p.difficulty}.`);
  }
  if (input.existing.length) {
    sections.push(
      `## Existing capabilities (keep them; add, extend or retire only as the task says)\n${input.existing
        .map((c) => `- [${c.id}]${c.mastered ? ' (mastered)' : ''} ${c.statement}\n  targets: ${c.targets.map((t) => `${t.name} [${t.nodeId}] depth ${t.depth}`).join('; ')}`)
        .join('\n')}`,
    );
  }
  if (input.newMaterial.length) sections.push(`## Material added since the last compile\n${input.newMaterial.map((t) => `- ${t}`).join('\n')}`);
  sections.push(`## Ideas in the goal's material\n${graphText}`);
  sections.push(
    input.existing.length
      ? '## Task\nRecompile incrementally: add capabilities and targets for what the new material covers, extend existing capabilities with new targets where they belong, and retire a capability only when a new one clearly supersedes it. Do not restate existing capabilities.'
      : '## Task\nCompile the goal: a short title, its capabilities and their targets.',
  );
  const result = await provider.complete({
    role: 'goalCompiler',
    system: loadPrompt('goal-compiler'),
    messages: [{ role: 'user', content: sections.join('\n\n') }],
    submit: { name: 'submit_compile', description: 'Submit the title, new capabilities, extensions, retirements and any new nodes.', schema: buildCompileSchema(knownIds, existingIds) },
  });
  return result.data;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
