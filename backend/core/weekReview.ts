/**
 * The weekly review (design §10, "Your week"), pure: which answers were too sure, and the one change
 * to the plan worth suggesting, chosen by fixed rules from what the week shows.
 */

/** Recall below this at the end of the week counts as faded. */
export const FADED_RECALL = 0.7;
/** "Fairly sure" or "Sure" (CONFIDENCE_LEVELS): an answer given this sure that scored low was too sure. */
export const SURE = 0.66;
/** Below this an answer was wrong rather than partly right. */
export const WRONG = 0.4;
/** A goal is behind when its week has under this share of the time its rhythm asks for so far. */
const BEHIND_SHARE = 0.6;
/** Fewer expected minutes than this is too little to call a goal behind. */
const MIN_EXPECTED = 30;
const MANY_FADED = 5;
const MANY_TOO_SURE = 3;

export interface AnswerLike {
  nodeId: string;
  score: number;
  confidence: number | null;
}

/** Ideas answered sure and wrong, most often first. */
export function tooSure(answers: AnswerLike[]): { nodeId: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of answers) if (a.confidence !== null && a.confidence >= SURE && a.score < WRONG) counts.set(a.nodeId, (counts.get(a.nodeId) ?? 0) + 1);
  return [...counts].map(([nodeId, count]) => ({ nodeId, count })).sort((a, b) => b.count - a.count || a.nodeId.localeCompare(b.nodeId));
}

export interface GoalWeek {
  goalId: string;
  title: string;
  /** Minutes studied for the goal in the week. */
  minutes: number;
  /** What its rhythm asks per week; null without a rhythm. */
  weeklyTarget: number | null;
  /** Minutes the plan no longer needs (the learner was faster or knew more); null when none. */
  roomMinutes: number | null;
}

export type SuggestionKind = 'start' | 'catchUp' | 'checkFirst' | 'practise' | 'useTime' | 'keep';

export interface Suggestion {
  kind: SuggestionKind;
  text: string;
  /** The goal the suggestion is about, for its action. */
  goalId: string | null;
  /** The ideas it is about (too sure, for "test me"). */
  nodeIds: string[];
}

/**
 * One change worth making, in this order: study at all; catch up a goal that is behind its rhythm;
 * check ideas answered sure and wrong before new material; refresh many faded ideas with practice; use
 * time a goal no longer needs; else keep the rhythm. `elapsed` is the share of the week gone (1 for a
 * past week), so the current week is judged on its days so far.
 */
export function suggestChange(input: { minutes: number; elapsed: number; goals: GoalWeek[]; faded: number; tooSure: { nodeId: string; name: string; count: number }[] }): Suggestion {
  const none = { goalId: null, nodeIds: [] as string[] };
  if (input.minutes < 1) return { kind: 'start', text: 'Nothing was studied this week. A short session or ten minutes of flashcards keeps what you learned from fading.', ...none };
  const behind = input.goals
    .map((g) => ({ g, expected: (g.weeklyTarget ?? 0) * input.elapsed }))
    .filter(({ g, expected }) => expected >= MIN_EXPECTED && g.minutes < expected * BEHIND_SHARE)
    .sort((a, b) => b.expected - b.g.minutes - (a.expected - a.g.minutes))[0];
  if (behind) {
    const { g, expected } = behind;
    return {
      kind: 'catchUp',
      text: `${g.title} is behind its rhythm: ${Math.round(g.minutes)} of about ${Math.round(expected)} minutes this week. Plan two short sessions for it, or lower its weekly time on its page so the plan fits your weeks.`,
      goalId: g.goalId,
      nodeIds: [],
    };
  }
  const wrongs = input.tooSure.reduce((n, t) => n + t.count, 0);
  if (wrongs >= MANY_TOO_SURE) {
    const names = input.tooSure.slice(0, 2).map((t) => t.name);
    return {
      kind: 'checkFirst',
      text: `You were sure and wrong ${wrongs} times, most on ${names.join(' and ')}. Test yourself on ${names.length === 1 ? 'it' : 'them'} before new material: what feels known is where a wrong idea hides.`,
      goalId: null,
      nodeIds: input.tooSure.slice(0, 4).map((t) => t.nodeId),
    };
  }
  if (input.faded >= MANY_FADED) return { kind: 'practise', text: `${input.faded} ideas faded this week. Start the next sessions with practice: one problem refreshes several ideas at once.`, ...none };
  const roomy = input.goals.filter((g) => (g.roomMinutes ?? 0) >= 30).sort((a, b) => (b.roomMinutes ?? 0) - (a.roomMinutes ?? 0))[0];
  if (roomy) return { kind: 'useTime', text: `${roomy.title} needs less time than planned. Use the freed time on its page to go deeper or add ideas.`, goalId: roomy.goalId, nodeIds: [] };
  return { kind: 'keep', text: 'You are on pace. Keep the same rhythm.', ...none };
}
