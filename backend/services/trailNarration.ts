/**
 * Narrating trails (design §8): one call that tells the learner how they got from where they started
 * to where they are, over one session or several. The digest is built here, in code, from the stored
 * trails: what was taught, how each idea went, where they stumbled, what they asked. The model only
 * words it.
 */
import { runTrailNarrator } from '../agents/trailNarrator';
import type { Narration } from '../agents/trailNarrator';
import type { LlmProvider } from '../llm/provider';
import type { Database } from '../store/db';
import { trail } from './trails';
import type { Trail, TrailItem } from './trails';

/** Sessions told at once: the latest this many when more are asked for. */
export const MAX_NARRATED_SESSIONS = 20;
/** The digest is cut to this size, each session keeping an even share. */
const MAX_DIGEST_CHARS = 24_000;
/** A stumble is an answer scored under this, a good answer one at or over `WENT_WELL`. */
const STUMBLE = 0.5;
const WENT_WELL = 0.85;
const MOMENTS = { stumbles: 3, wentWell: 2, questions: 2, practice: 2 };

export interface TrailNarration extends Narration {
  /** How many sessions the story covers. */
  sessions: number;
}

const percent = (score: number | null) => (score === null ? 'not scored' : `${Math.round(score * 100)}%`);

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

type Step = Extract<TrailItem, { type: 'step' }>;

/** One session as the narrator reads it. */
function sessionDigest(t: Trail, number: number): string {
  const { summary, items } = t;
  const lines: string[] = [`## Session ${number} · ${summary.startedAt.slice(0, 10)}${summary.goalTitle ? ` · goal: ${summary.goalTitle}` : ''}`];
  lines.push(`Title: ${summary.title}`);
  if (summary.asked) lines.push(`They asked for: ${summary.asked.description ? `"${clip(summary.asked.description, 200)}"` : `the ideas they picked (${summary.asked.picked.map((n) => clip(n, 60)).join(', ')})`}`);
  if (summary.status === 'abandoned') lines.push('It ended early.');

  const recall = items.find((i): i is Extract<TrailItem, { type: 'recall' }> => i.type === 'recall');
  if (recall && recall.recalled.length) lines.push(`It began by recalling: ${recall.recalled.map((r) => `${clip(r.name, 60)} (${percent(r.score)})`).join(', ')}`);

  const checked = items.filter((i): i is Extract<TrailItem, { type: 'check-first' }> => i.type === 'check-first');
  if (checked.length) lines.push(`Opened with a check, because they said they knew the material: ${checked.map((c) => clip(c.idea, 60)).join(', ')}`);
  const done = items.filter((i): i is Extract<TrailItem, { type: 'idea-done' }> => i.type === 'idea-done');
  if (done.length) lines.push(`Ideas finished: ${done.map((d) => `${clip(d.idea, 60)} (${percent(d.score)})`).join(', ')}`);

  const graded = items.filter((i): i is Step => i.type === 'step' && i.grade !== null && i.response !== null);
  const moment = (s: Step) => `${clip(s.idea, 60)}, ${s.stage}: scored ${percent(s.grade?.score ?? null)}. They wrote: "${clip(s.response?.answer ?? '', 160)}". ${s.grade?.misconception ? `Misconception noted: ${clip(s.grade.misconception, 140)}. ` : ''}${clip(s.grade?.feedback ?? '', 160)}`;
  const stumbles = graded.filter((s) => (s.grade?.score ?? 1) < STUMBLE).sort((a, b) => (a.grade?.score ?? 0) - (b.grade?.score ?? 0)).slice(0, MOMENTS.stumbles);
  if (stumbles.length) lines.push('Stumbled:', ...stumbles.map((s) => `- ${moment(s)}`));
  const wentWell = graded.filter((s) => (s.grade?.score ?? 0) >= WENT_WELL).slice(-MOMENTS.wentWell);
  if (wentWell.length) lines.push('Went well:', ...wentWell.map((s) => `- ${clip(s.idea, 60)}, ${s.stage}: scored ${percent(s.grade?.score ?? null)}`));

  const asides = items.flatMap((i) => (i.type === 'step' ? i.asides : []));
  const hints = asides.filter((a) => a.mode === 'hint').length;
  const questions = asides.filter((a) => a.mode === 'question' && a.question).slice(0, MOMENTS.questions);
  if (hints || questions.length) lines.push(`Asked the tutor: ${[hints ? `${hints} ${hints === 1 ? 'hint' : 'hints'}` : null, ...questions.map((q) => `"${clip(q.question, 120)}"`)].filter(Boolean).join('; ')}`);

  const practice = items.filter((i): i is Extract<TrailItem, { type: 'practice' }> => i.type === 'practice').slice(0, MOMENTS.practice);
  if (practice.length) lines.push('Practice:', ...practice.map((p) => `- "${clip(p.statement, 120)}": ${percent(p.score)}`));

  const close = items.find((i): i is Extract<TrailItem, { type: 'close' }> => i.type === 'close');
  if (close?.canDo) lines.push(`It ended with: ${clip(close.canDo, 200)}`);
  return lines.join('\n');
}

/** What the narrator reads: the sessions oldest first, each cut to an even share when there is too much. */
export function trailDigest(trails: Trail[]): string {
  const ordered = [...trails].sort((a, b) => a.summary.startedAt.localeCompare(b.summary.startedAt));
  const gaps = 2 * Math.max(0, ordered.length - 1);
  const share = Math.floor((MAX_DIGEST_CHARS - gaps) / Math.max(1, ordered.length));
  return ordered.map((t, i) => cutBlock(sessionDigest(t, i + 1), share)).join('\n\n');
}

/** Cuts a block of lines to a size without flattening its lines. */
function cutBlock(block: string, max: number): string {
  return block.length > max ? `${block.slice(0, max - 1)}…` : block;
}

/**
 * The story of these sessions. Sessions that are gone are left out; with more than the limit the
 * latest are told.
 */
export async function narrateTrails(deps: { db: Database; provider: LlmProvider }, sessionIds: string[], signal?: AbortSignal): Promise<TrailNarration> {
  const trails: Trail[] = [];
  for (const id of new Set(sessionIds)) {
    try {
      trails.push(trail(deps.db, id));
    } catch {
      // erased or never there: the rest is still worth telling
    }
  }
  if (trails.length === 0) throw new Error('Those sessions are no longer there.');
  const latest = trails.sort((a, b) => b.summary.startedAt.localeCompare(a.summary.startedAt)).slice(0, MAX_NARRATED_SESSIONS);
  const narration = await runTrailNarrator(deps.provider, trailDigest(latest), signal);
  return { ...narration, sessions: latest.length };
}
