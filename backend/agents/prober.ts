import { z } from 'zod';
import type { LlmProvider } from '../llm/provider';
import { confidenceLabel } from '../core/types';
import { answerReadingPrompt, loadPrompt } from './prompts';

export interface ProbeCandidate {
  nodeId: string;
  kind: string;
  name: string;
  statement: string;
  information: number;
  premises: { id: string; name: string }[];
  currentDepth: number;
  targetDepth: number;
}

export const ProbeQuestionSchema = z.object({
  nodeId: z.string().min(1),
  kind: z.enum(['check', 'derive', 'use']),
  question: z.string().trim().min(10).max(1200),
  answerKey: z.string().trim().min(5).max(2000),
  rubric: z.array(z.string().trim().min(3).max(300)).min(1).max(6),
});
export type ProbeQuestion = z.infer<typeof ProbeQuestionSchema>;

export function buildProbeSchema(candidateIds: Set<string>, maxQuestions: number) {
  return z
    .object({ questions: z.array(ProbeQuestionSchema).min(1).max(maxQuestions) })
    .superRefine((value, ctx) => {
      const seen = new Set<string>();
      value.questions.forEach((q, i) => {
        if (!candidateIds.has(q.nodeId)) ctx.addIssue({ code: 'custom', path: ['questions', i, 'nodeId'], message: `${q.nodeId} is not a candidate` });
        if (seen.has(q.nodeId)) ctx.addIssue({ code: 'custom', path: ['questions', i, 'nodeId'], message: `one question per node; ${q.nodeId} repeats` });
        seen.add(q.nodeId);
      });
    });
}

export async function generateProbeQuestions(provider: LlmProvider, goalText: string, candidates: ProbeCandidate[], maxQuestions: number): Promise<ProbeQuestion[]> {
  const list = candidates
    .map(
      (c) =>
        `- [${c.nodeId}] ${c.name} (${c.kind}) — information ${c.information.toFixed(2)}, current depth ${c.currentDepth}, target depth ${c.targetDepth}\n  ${c.statement}\n  premises: ${c.premises.length ? c.premises.map((p) => `[${p.id}] ${p.name}`).join('; ') : 'none'}`,
    )
    .join('\n');
  const result = await provider.complete({
    role: 'prober',
    system: loadPrompt('prober'),
    messages: [{ role: 'user', content: `Goal: ${goalText}\n\nWrite at most ${maxQuestions} questions.\n\n## Candidates (highest information first)\n${list}` }],
    submit: { name: 'submit_probe_questions', description: 'Submit the probe questions with answer keys and rubrics.', schema: buildProbeSchema(new Set(candidates.map((c) => c.nodeId)), maxQuestions) },
  });
  return result.data.questions;
}

export interface ProbeAnswer {
  nodeId: string;
  question: string;
  answerKey: string;
  rubric: string[];
  answer: string;
  confidence: number | null;
}

export const AssessmentSchema = z.object({
  nodeId: z.string().min(1),
  score: z.number().min(0).max(1),
  reasoning: z.string().trim().min(1).max(800),
  misconception: z.string().trim().max(300).nullable().default(null),
});
export type Assessment = z.infer<typeof AssessmentSchema>;

export function buildAssessmentSchema(nodeIds: Set<string>) {
  return z.object({ assessments: z.array(AssessmentSchema).min(1) }).superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.assessments.forEach((a, i) => {
      if (!nodeIds.has(a.nodeId)) ctx.addIssue({ code: 'custom', path: ['assessments', i, 'nodeId'], message: `unknown nodeId ${a.nodeId}` });
      seen.add(a.nodeId);
    });
    for (const id of nodeIds) if (!seen.has(id)) ctx.addIssue({ code: 'custom', path: ['assessments'], message: `missing an assessment for ${id}` });
  });
}

export async function assessProbeAnswers(provider: LlmProvider, answers: ProbeAnswer[]): Promise<Assessment[]> {
  const body = answers
    .map(
      (a) =>
        `### ${a.nodeId}\nQuestion: ${a.question}\nAnswer key: ${a.answerKey}\nRubric:\n${a.rubric.map((r) => `- ${r}`).join('\n')}\n\nLearner answer${a.confidence === null ? '' : ` (confidence: ${confidenceLabel(a.confidence)})`}: ${a.answer.trim() ? a.answer : '(empty: the learner has no idea)'}`,
    )
    .join('\n\n');
  const result = await provider.complete({
    role: 'prober',
    system: answerReadingPrompt('prober'),
    messages: [{ role: 'user', content: `Judge these answers.\n\n${body}` }],
    submit: { name: 'submit_assessments', description: 'Submit one assessment per question.', schema: buildAssessmentSchema(new Set(answers.map((a) => a.nodeId))) },
  });
  return result.data.assessments;
}
