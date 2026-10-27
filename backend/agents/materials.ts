import { z } from 'zod';
import { MATERIAL_ROLES } from '../core/types';
import type { Assessment, ExamProfile, MaterialRole, UpcomingUnit } from '../core/types';
import type { LlmProvider } from '../llm/provider';
import { loadPrompt } from './prompts';

const ROLE_SCHEMA = z.object({ role: z.enum(MATERIAL_ROLES as [MaterialRole, ...MaterialRole[]]), reason: z.string().trim().min(3).max(200) });

/** Guess what a file added to a goal is for, from its title and opening text. The learner can change it. */
export async function guessMaterialRole(provider: LlmProvider, input: { title: string; text: string }): Promise<{ role: MaterialRole; reason: string }> {
  const result = await provider.complete({
    role: 'extractor',
    system: loadPrompt('material-role'),
    messages: [{ role: 'user', content: `File: ${input.title}\n\n## Opening text\n${input.text.slice(0, 6000) || '(no text could be read)'}` }],
    submit: { name: 'submit_role', description: 'Submit the role of this material.', schema: ROLE_SCHEMA },
  });
  return result.data;
}

export const ExamProfileSchema = z.object({
  summary: z.string().trim().min(10).max(400),
  format: z.string().trim().min(2).max(200),
  durationMinutes: z.number().int().min(5).max(600).nullable(),
  aids: z.string().trim().min(2).max(200),
  questionTypes: z.array(z.string().trim().min(2).max(120)).min(1).max(8),
  difficulty: z.string().trim().min(2).max(200),
});

export const CourseProfileSchema = z.object({
  examProfile: ExamProfileSchema.nullable(),
  upcoming: z
    .array(z.object({ title: z.string().trim().min(2).max(120), expected: z.string().trim().max(60).nullable() }))
    .max(30)
    .default([]),
});

export interface CourseProfileInput {
  goalText: string;
  assessment: Assessment;
  date: string | null;
  /** Past exams, mock exams, grading criteria. */
  assessmentMaterials: { title: string; text: string }[];
  /** Syllabus, module description. */
  scopeMaterials: { title: string; text: string }[];
  /** Teaching material already in, so upcoming units exclude it. */
  teachingTitles: string[];
}

/** Summarize past exams into an exam profile, and read the scope document for what is still to come. */
export async function runCourseProfile(provider: LlmProvider, input: CourseProfileInput): Promise<{ examProfile: ExamProfile | null; upcoming: UpcomingUnit[] }> {
  const docs = (label: string, list: { title: string; text: string }[], budget: number) =>
    list.length ? `## ${label}\n${list.map((m) => `### ${m.title}\n${m.text.slice(0, Math.floor(budget / list.length))}`).join('\n\n')}` : `## ${label}\n(none)`;
  const message = [
    `## Goal\n${input.goalText}\nAssessed by: ${input.assessment.replace(/_/g, ' ')}.${input.date ? ` Date: ${input.date}.` : ''}`,
    docs('Assessment material (past exams, grading criteria)', input.assessmentMaterials, 24000),
    docs('Scope material (syllabus, module description)', input.scopeMaterials, 12000),
    `## Teaching material already added\n${input.teachingTitles.length ? input.teachingTitles.map((t) => `- ${t}`).join('\n') : '(none)'}`,
  ].join('\n\n');
  const result = await provider.complete({
    role: 'goalCompiler',
    system: loadPrompt('course-profile'),
    messages: [{ role: 'user', content: message }],
    submit: { name: 'submit_course_profile', description: 'Submit the exam profile (or null) and the upcoming units.', schema: CourseProfileSchema },
  });
  return result.data;
}
