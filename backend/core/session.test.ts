import { describe, expect, it } from 'vitest';
import { applyGrade, cardBranches, certifyingStage, countedScore, emptyEdge, evidenceKindFor, followUp, ideaAllowance, nextStage, stagesFor, timebox } from './session';
import type { EdgeState } from './session';

const grade = (edge: EdgeState, score: number, stage: Parameters<typeof applyGrade>[1]['stage'] = 'check', aim = 2, confidence?: number) => applyGrade(edge, { score, stage, aim, confidence });

describe('session mechanics', () => {
  it('fits the step loop to the aim and stops there', () => {
    expect(stagesFor(1)).toEqual(['index']);
    expect(stagesFor(2)).toEqual(['predict', 'explain', 'check', 'compress']);
    expect(stagesFor(3)).toEqual(['predict', 'explain', 'check', 'derive', 'connect', 'compress']);
    expect(stagesFor(4)).toEqual(['predict', 'explain', 'check', 'derive', 'connect', 'compress', 'use']);
    // deepening an idea the learner already explains
    expect(stagesFor(3, 2)).toEqual(['predict', 'explain', 'derive']);
    expect(stagesFor(4, 3)).toEqual(['predict', 'explain', 'use']);
    expect([1, 2, 3, 4].map(certifyingStage)).toEqual(['index', 'check', 'derive', 'use']);
  });

  it('maps stages to evidence kinds', () => {
    expect(evidenceKindFor('predict')).toBe('predict');
    expect(evidenceKindFor('compress')).toBe('explain');
    expect(evidenceKindFor('index')).toBe('predict');
    expect(evidenceKindFor('connect')).toBeNull();
    expect(evidenceKindFor('explain')).toBeNull();
  });

  it('three failures in a row trigger support and reset', () => {
    let edge = emptyEdge();
    let action;
    ({ edge, action } = grade(edge, 0.2));
    expect(action).toBe('retry'); // the first miss of a question brings it once more, and still counts
    ({ edge, action } = grade(edge, 0.4));
    expect(action).toBe('none');
    ({ edge, action } = grade(edge, 0.1));
    expect(action).toBe('support');
    expect(edge.consecutiveFailures).toBe(0);
  });

  it('asks a missed question again once, in each of check, derive and use', () => {
    for (const stage of ['check', 'derive', 'use'] as const) {
      const first = grade(emptyEdge(), 0.3, stage, 4);
      expect(first.action, stage).toBe('retry');
      expect(nextStage(stagesFor(4), stage, first.action)).toBe(stage);
      expect(grade(first.edge, 0.3, stage, 4).action, stage).toBe('none'); // only once
    }
    // not a failure, not a pass: asked again too, without counting as a failure
    const middling = grade(emptyEdge(), 0.6, 'check', 3);
    expect(middling.action).toBe('retry');
    expect(middling.edge.consecutiveFailures).toBe(0);
    // a pass moves on; a question of another kind is never asked again
    expect(grade(emptyEdge(), 0.7, 'check', 3).action).toBe('none');
    expect(grade(emptyEdge(), 0.2, 'connect', 3).action).toBe('none');
    // what was asked again is remembered for the idea, across the other rules
    expect(grade(first(), 0.9, 'derive', 4).edge.retried).toEqual(['check']);
    function first() {
      return grade(emptyEdge(), 0.3, 'check', 4).edge;
    }
  });

  it('a missed prediction is no failure', () => {
    let edge = emptyEdge();
    let action;
    ({ edge, action } = grade(edge, 0.1, 'predict', 3));
    expect(action).toBe('none');
    expect(edge.consecutiveFailures).toBe(0);
    // so a worked example comes after three missed questions, not two and a guess
    ({ edge, action } = grade(edge, 0.1, 'check', 3));
    ({ edge, action } = grade(edge, 0.1, 'check', 3));
    expect(action).toBe('none');
    ({ edge, action } = grade(edge, 0.1, 'derive', 3));
    expect(action).toBe('support');
  });

  it('an answer given with hints counts for less', () => {
    expect(countedScore(0.9, 0)).toBe(0.9);
    expect(countedScore(1, 1)).toBeCloseTo(0.85);
    expect(countedScore(1, 2)).toBeCloseTo(0.7); // with both hints only a full answer still passes
    expect(countedScore(0.8, 1)).toBeLessThan(0.7);
    expect(countedScore(1, 5)).toBeCloseTo(0.7);
  });

  it('a middling score resets both counters', () => {
    const { edge } = grade({ consecutiveFailures: 2, strongStreak: 1 }, 0.6);
    expect(edge).toMatchObject({ consecutiveFailures: 0, strongStreak: 0 });
  });

  it('escalates once when the learner still fails after a worked example', () => {
    let edge = emptyEdge();
    let action;
    for (const score of [0.1, 0.1, 0.1]) ({ edge, action } = grade(edge, score));
    expect(action).toBe('support');
    ({ edge, action } = grade(edge, 0.2));
    expect(action).toBe('escalate');
    ({ edge, action } = grade(edge, 0.2));
    expect(action).toBe('none'); // the escalation is used once per idea
    ({ edge, action } = grade(edge, 0.8));
    expect(edge).toMatchObject({ supported: true, escalated: true });
  });

  it('checks an idea off when the learner knows it: a strong prediction tests out, a strong answer ends it', () => {
    const stages = stagesFor(3);
    let { edge, action } = grade(emptyEdge(), 0.95, 'predict', 3, 0.9);
    expect(action).toBe('testOut');
    expect(nextStage(stages, 'predict', action, edge, 3)).toBe('derive');
    ({ edge, action } = grade(edge, 0.9, 'derive', 3, 0.66));
    expect(action).toBe('done');
    expect(nextStage(stages, 'derive', action, edge, 3)).toBeNull();
  });

  it('two strong answers in a row jump to the aim, and a guess is never strong', () => {
    const stages = stagesFor(3);
    let { edge, action } = grade(emptyEdge(), 0.9, 'predict', 3, 0.33);
    expect(action).toBe('none'); // right, but a guess
    ({ edge, action } = grade(edge, 0.9, 'check', 3, 0.9));
    expect(action).toBe('none');
    expect(edge.strongStreak).toBe(1);
    ({ edge, action } = grade(edge, 1, 'connect', 3));
    expect(action).toBe('testOut');
    expect(nextStage(stages, 'connect', action, edge, 3)).toBe('compress'); // the aim's question already passed: carry on
  });

  it('a failed test-out goes back to teaching where the jump left off', () => {
    const stages = stagesFor(2);
    let { edge, action } = grade(emptyEdge(), 0.9, 'predict', 2);
    expect(action).toBe('testOut');
    ({ edge, action } = grade(edge, 0.3, 'check', 2));
    expect(action).toBe('resume');
    expect(nextStage(stages, 'check', action, edge, 2)).toBe('explain');
  });

  it('wrapping up goes to the learner’s own words when still ahead, else ends', () => {
    const stages = stagesFor(3);
    expect(nextStage(stages, 'check', 'wrapUp')).toBe('compress');
    expect(nextStage(stages, 'compress', 'wrapUp')).toBeNull();
    expect(nextStage(['index'], 'index', 'wrapUp')).toBeNull();
  });

  it('gives an idea its half hour: simplifies when the background is missing, wraps up when time is up', () => {
    const base = { minutes: 5, allowance: 30, aim: 3, simplified: false, edge: emptyEdge(), missingBackground: false };
    expect(timebox(base)).toBe('none');
    expect(timebox({ ...base, missingBackground: true })).toBe('simplify');
    expect(timebox({ ...base, edge: { consecutiveFailures: 2, strongStreak: 0 } })).toBe('none'); // struggling, but early
    expect(timebox({ ...base, minutes: 19, edge: { consecutiveFailures: 2, strongStreak: 0 } })).toBe('simplify');
    expect(timebox({ ...base, minutes: 19, edge: { consecutiveFailures: 0, strongStreak: 0, supported: true } })).toBe('simplify');
    expect(timebox({ ...base, minutes: 19, simplified: true, missingBackground: true })).toBe('none'); // once
    expect(timebox({ ...base, aim: 1, missingBackground: true })).toBe('none');
    expect(timebox({ ...base, minutes: 30 })).toBe('wrapUp');
    expect(ideaAllowance(66)).toBe(30);
    expect(ideaAllowance(3.5)).toBe(10);
    expect(ideaAllowance(25)).toBe(25);
  });
});

describe('the card a grade leads to (R7 C1)', () => {
  const step = (aim: number) => ({ aim, stages: stagesFor(aim), minutes: 25, simplified: false });
  const fresh = { consecutiveFailures: 0, strongStreak: 0 };

  it('a prediction leads to the explanation, or, strong and sure, straight to the question that shows the aim', () => {
    expect(cardBranches(fresh, step(2), 'predict', { confidence: 0.9, hints: 0, minutes: 2 })).toEqual([
      { from: 0, below: 0.85, card: { stage: 'explain', retry: false } },
      { from: 0.85, below: null, card: { stage: 'check', retry: false } },
    ]);
    // a guess is never strong
    expect(cardBranches(fresh, step(2), 'predict', { confidence: 0.33, hints: 0, minutes: 2 })).toEqual([{ from: 0, below: null, card: { stage: 'explain', retry: false } }]);
  });

  it('a missed question is asked again, a passed one goes on, and hints move the bands', () => {
    expect(cardBranches(fresh, step(2), 'check', { confidence: 0.66, hints: 0, minutes: 8 })).toEqual([
      { from: 0, below: 0.7, card: { stage: 'check', retry: true } },
      { from: 0.7, below: null, card: { stage: 'compress', retry: false } },
    ]);
    // with one hint an answer counts 0.85 of its score: it needs 0.83 to count as a pass
    expect(cardBranches(fresh, step(2), 'check', { confidence: 0.66, hints: 1, minutes: 8 })[1]?.from).toBe(0.83);
  });

  it('the question that finishes an idea leads to no card, and a third failure to a worked example', () => {
    const jumped = { ...fresh, jumpedFrom: 'predict' as const };
    expect(cardBranches(jumped, step(2), 'check', { confidence: 0.9, hints: 0, minutes: 8 }).at(-1)).toEqual({ from: 0.85, below: null, card: null });
    const failing = { consecutiveFailures: 2, strongStreak: 0, retried: ['check' as const] };
    expect(cardBranches(failing, step(2), 'check', { confidence: 0.66, hints: 0, minutes: 8 })[0]).toEqual({ from: 0, below: 0.5, card: { stage: 'support', retry: false } });
  });

  it('decides after a grade exactly as the bands said before it', () => {
    for (const score of [0.1, 0.45, 0.6, 0.75, 0.9]) {
      const band = cardBranches(fresh, step(3), 'check', { confidence: 0.9, hints: 0, minutes: 8 }).find((b) => score >= b.from && (b.below === null || score < b.below));
      const { then } = followUp(fresh, step(3), 'check', { score, confidence: 0.9, missingBackground: false, minutes: 8 });
      expect(typeof then === 'object' ? then : null).toEqual(band?.card ? band.card : { stage: null, retry: false });
    }
  });
});
