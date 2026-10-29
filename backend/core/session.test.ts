import { describe, expect, it } from 'vitest';
import { applyGrade, certifyingStage, emptyEdge, evidenceKindFor, ideaAllowance, nextStage, stagesFor, timebox } from './session';
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
    expect(action).toBe('none');
    ({ edge, action } = grade(edge, 0.4));
    expect(action).toBe('none');
    ({ edge, action } = grade(edge, 0.1));
    expect(action).toBe('support');
    expect(edge.consecutiveFailures).toBe(0);
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
