import { z } from 'zod';
import { CodeStarterSchema } from '../core/code';
import type { ProblemSpec } from '../core/scheduler';
import type { Assessment } from '../core/types';
import type { LlmProvider } from '../llm/provider';
import { loadPrompt } from './prompts';

export interface ProblemIdea {
  id: string;
  name: string;
  kind: string;
  statement: string;
  ownStatement: string | null;
  premises: string[];
}

export interface GeneratorSpec extends ProblemSpec {
  ideas: ProblemIdea[];
  /** Open misconceptions on these ideas: a problem may contrast them. */
  bugs: string[];
}

export interface GeneratorInput {
  goalText: string;
  assessment: Assessment;
  examStyle: string | null;
  /** Excerpts from the goal's practice material (exercise sheets), for problem style. */
  practiceStyle: { title: string; text: string }[];
  specs: GeneratorSpec[];
  /** Recent problem statements on these ideas; new problems must not repeat them. */
  recent: string[];
  mock: boolean;
}

export const GeneratedProblemSchema = z.object({
  index: z.number().int().min(0),
  statement: z.string().trim().min(20).max(4000),
  solution: z.string().trim().min(10).max(6000),
  rubric: z.array(z.string().trim().min(3).max(300)).min(2).max(6),
  /** When the problem is answered in code: starter code for the learner's editor. */
  code: CodeStarterSchema.nullable().optional(),
});
export type GeneratedProblem = z.infer<typeof GeneratedProblemSchema>;

const normalize = (s: string) => s.toLowerCase().replace(/\$/g, '').replace(/\s+/g, ' ').trim();

/**
 * Names a problem may not say. Composition and path-finding problems (rung 3+) must make the
 * learner retrieve the ideas unaided, so naming one gives the answer away (design §5.1).
 */
export function forbiddenNames(spec: GeneratorSpec): string[] {
  if (spec.rung < 3) return [];
  return spec.ideas.map((i) => normalize(i.name)).filter((n) => n.length >= 5);
}

export function buildGeneratorSchema(input: GeneratorInput) {
  const recent = new Set(input.recent.map(normalize));
  return z.object({ problems: z.array(GeneratedProblemSchema).length(input.specs.length) }).superRefine((value, ctx) => {
    const seen = new Set<number>();
    value.problems.forEach((p, i) => {
      const spec = input.specs[p.index];
      if (!spec) {
        ctx.addIssue({ code: 'custom', path: ['problems', i, 'index'], message: `no problem spec ${p.index}` });
        return;
      }
      if (seen.has(p.index)) ctx.addIssue({ code: 'custom', path: ['problems', i, 'index'], message: `spec ${p.index} has two problems` });
      seen.add(p.index);
      const text = normalize(p.statement);
      for (const name of forbiddenNames(spec)) {
        if (text.includes(name)) ctx.addIssue({ code: 'custom', path: ['problems', i, 'statement'], message: `the statement names "${name}"; the learner has to find which ideas apply` });
      }
      if (recent.has(text)) ctx.addIssue({ code: 'custom', path: ['problems', i, 'statement'], message: 'this repeats a recent problem; write a new one' });
    });
  });
}

const RUNG = ['worked example', 'completion (finish a half-solved problem)', 'direct exercise', 'composition (several ideas together)', 'path-finding (the learner must find which ideas apply)'];
const CUE = ['lesson context (the framing it was taught in)', 'adjacent context', 'far context (a new situation where the ideas still genuinely apply)'];

export async function generateProblems(provider: LlmProvider, input: GeneratorInput): Promise<GeneratedProblem[]> {
  const sections: string[] = [`## Goal\n${input.goalText}\nAssessment: ${input.assessment.replace(/_/g, ' ')}`];
  if (input.examStyle) sections.push(`## Exam style (from past exams)\n${input.examStyle}`);
  if (input.practiceStyle.length) sections.push(`## Problem style from the goal's exercise sheets\n${input.practiceStyle.map((p) => `### ${p.title}\n${p.text}`).join('\n\n')}`);
  sections.push(
    `## Problems to write${input.mock ? ' (a mock exam: write each as that exam would ask it)' : ''}\n${input.specs
      .map(
        (s, i) =>
          `### Problem ${i}\nRung: ${s.rung}, ${RUNG[s.rung]}\nCue distance: ${s.cue}, ${CUE[s.cue]}\nPresentation: ${s.presentation}\nIdeas it must need (for you only):\n${s.ideas
            .map((idea) => `- [${idea.id}] ${idea.name} (${idea.kind}): ${idea.statement}${idea.premises.length ? `\n  built on: ${idea.premises.join('; ')}` : ''}${idea.ownStatement ? `\n  the learner's own words: "${idea.ownStatement}"` : ''}`)
            .join('\n')}${s.bugs.length ? `\nMisconceptions to contrast:\n${s.bugs.map((b) => `- ${b}`).join('\n')}` : ''}`,
      )
      .join('\n\n')}`,
  );
  if (input.recent.length) sections.push(`## Recent problems on these ideas (do not repeat them)\n${input.recent.map((r) => `- ${r.slice(0, 300)}`).join('\n')}`);
  const result = await provider.complete({
    role: 'problemGenerator',
    system: loadPrompt('problem-generator'),
    messages: [{ role: 'user', content: sections.join('\n\n') }],
    submit: { name: 'submit_problems', description: 'Submit one problem per spec, each with its worked solution and rubric.', schema: buildGeneratorSchema(input) },
  });
  return [...result.data.problems].sort((a, b) => a.index - b.index);
}
