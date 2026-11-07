import { z } from 'zod';
import { MAX_FREE_IDEAS } from '../core/freeSession';
import type { GoalFocus, GoalLevel, NodeKind } from '../core/types';
import type { LlmProvider } from '../llm/provider';
import { loadPrompt } from './prompts';

/** An idea the map already has, as the session maker sees it. */
export interface MakerIdea {
  id: string;
  kind: NodeKind;
  name: string;
  statement: string;
  /** The learner's depth on it (0–5). */
  depth: number;
  owned: boolean;
}

export interface SessionMakerInput {
  /** What the learner wants to learn, in their words. */
  description: string;
  /** The goal the session is for, when the learner chose one. */
  goal: { text: string; level: GoalLevel | null; scope: string | null; focus: GoalFocus[]; background: string | null; context: string | null } | null;
  /** Ideas on the map that match the description (and the goal's ideas, with a goal). */
  matches: MakerIdea[];
  /** Ideas the learner owns, for the level and the background (deduplicated against `matches`). */
  owned: { id: string; name: string }[];
  /** Minutes per aim (1 overview … 4 apply) at this learner's speed, for sizing the session. */
  minutesPerAim: Record<1 | 2 | 3 | 4, number>;
  sessionMinutes: number;
}

const TEMP_ID = /^n\d{1,2}$/;
const ref = z.string().trim().min(1);

export function buildSessionMakerSchema(known: ReadonlySet<string>) {
  return z
    .object({
      title: z.string().trim().min(2).max(80),
      summary: z.string().trim().min(10).max(400),
      level: z.enum(['intuition', 'working', 'rigorous']),
      ideas: z
        .array(z.object({ ref, aim: z.number().int().min(1).max(4), why: z.string().trim().min(5).max(300) }))
        .min(1)
        .max(MAX_FREE_IDEAS),
      newIdeas: z
        .array(
          z.object({
            tempId: z.string().regex(TEMP_ID, 'temp ids look like n1, n2'),
            kind: z.enum(['claim', 'procedure', 'term']),
            name: z.string().trim().min(2).max(120),
            statement: z.string().trim().min(10).max(1500),
            premises: z.array(ref).max(6).default([]),
          }),
        )
        .max(MAX_FREE_IDEAS + 3)
        .default([]),
      background: z
        .array(z.object({ ref, reason: z.string().trim().min(5).max(300) }))
        .max(3)
        .default([]),
    })
    .superRefine((value, ctx) => {
      const temps = new Set<string>();
      value.newIdeas.forEach((n, i) => {
        if (temps.has(n.tempId)) ctx.addIssue({ code: 'custom', path: ['newIdeas', i, 'tempId'], message: `${n.tempId} is used twice` });
        if (known.has(n.tempId)) ctx.addIssue({ code: 'custom', path: ['newIdeas', i, 'tempId'], message: `${n.tempId} is an existing id` });
        temps.add(n.tempId);
      });
      const resolves = (id: string) => known.has(id) || temps.has(id);
      const taught = new Set<string>();
      value.ideas.forEach((s, i) => {
        if (!resolves(s.ref)) ctx.addIssue({ code: 'custom', path: ['ideas', i, 'ref'], message: `${s.ref} is neither an id from the lists nor a temp id of a new idea` });
        if (taught.has(s.ref)) ctx.addIssue({ code: 'custom', path: ['ideas', i, 'ref'], message: `${s.ref} appears twice` });
        taught.add(s.ref);
      });
      value.newIdeas.forEach((n, i) => {
        n.premises.forEach((p, j) => {
          if (!resolves(p) || p === n.tempId) ctx.addIssue({ code: 'custom', path: ['newIdeas', i, 'premises', j], message: `${p} is not an id from the lists or another new idea` });
        });
      });
      value.background.forEach((b, i) => {
        if (!resolves(b.ref)) ctx.addIssue({ code: 'custom', path: ['background', i, 'ref'], message: `${b.ref} is neither an id from the lists nor a temp id of a new idea` });
        if (taught.has(b.ref)) ctx.addIssue({ code: 'custom', path: ['background', i, 'ref'], message: `${b.ref} is taught in the session, so it is not missing background` });
      });
      // every new idea must be taught, be background, or be what a taught new idea builds on
      const used = new Set([...taught, ...value.background.map((b) => b.ref)]);
      for (const n of value.newIdeas) if (taught.has(n.tempId)) for (const p of n.premises) used.add(p);
      value.newIdeas.forEach((n, i) => {
        if (!used.has(n.tempId)) ctx.addIssue({ code: 'custom', path: ['newIdeas', i], message: `${n.tempId} is not taught, not background and no taught idea builds on it; leave it out` });
      });
    });
}

export type SessionMakerResult = z.infer<ReturnType<typeof buildSessionMakerSchema>>;

const LEVEL_TEXT: Record<GoalLevel, string> = { intuition: 'intuition', working: 'working knowledge', rigorous: 'rigorous' };

export async function runSessionMaker(provider: LlmProvider, input: SessionMakerInput): Promise<SessionMakerResult> {
  const idea = (n: MakerIdea) => `- [${n.id}] ${n.name} (${n.kind}; ${n.owned ? `yours, depth ${n.depth}` : n.depth > 0 ? `seen, depth ${n.depth}` : 'not learned yet'})\n  ${n.statement}`;
  const sections = [`## What the learner wants to learn\n${input.description}`];
  if (input.goal) {
    const g = input.goal;
    const lines = [`## The goal this session is for\n${g.text}`];
    if (g.level) lines.push(`Level of the goal: ${LEVEL_TEXT[g.level]}.`);
    if (g.scope) lines.push(`What the goal means in the learner's time: ${g.scope}`);
    if (g.focus.length) lines.push(`The learner wants: ${g.focus.join(', ')}.`);
    if (g.background) lines.push(`What the learner says they already know: ${g.background}`);
    if (g.context) lines.push(`The learner's context for the goal (reasons, constraints, focus):\n${g.context}`);
    sections.push(lines.join('\n'));
  } else {
    sections.push('## The goal this session is for\nNone: the learner studies this for its own sake.');
  }
  sections.push(`## Ideas on the map that match\n${input.matches.length ? input.matches.map(idea).join('\n') : '(none: the map has nothing on this yet)'}`);
  sections.push(`## Other ideas the learner owns\n${input.owned.length ? input.owned.map((o) => `- [${o.id}] ${o.name}`).join('\n') : '(nothing yet)'}`);
  const m = input.minutesPerAim;
  sections.push(
    `## Time\nThe session has about ${input.sessionMinutes} minutes. For this learner an idea takes about ${m[1]} minutes as an overview (aim 1), ${m[2]} to explain (aim 2), ${m[3]} to explain and derive (aim 3) and ${m[4]} to apply (aim 4); terms take half. Choose ideas and aims that together fit the session, at most ${MAX_FREE_IDEAS} ideas.`,
  );
  const known = new Set([...input.matches.map((n) => n.id), ...input.owned.map((o) => o.id)]);
  const result = await provider.complete({
    role: 'sessionPlanner',
    system: loadPrompt('session-planner'),
    messages: [{ role: 'user', content: sections.join('\n\n') }],
    submit: { name: 'submit_session', description: 'Submit the session: its ideas in teaching order, new ideas, level and missing background.', schema: buildSessionMakerSchema(known) },
  });
  return result.data;
}
