import { describe, expect, it } from 'vitest';
import { applyReview, emptyFsrs } from './fsrs';
import { indexChains } from './graph';
import { FADING_RECALL, atLevel, chooseMode, dailyMinutes, dueForecast, dueNodes, groupForPractice, isMaintained, mockExamSpecs, mockExamsOpen, specifyProblem } from './scheduler';
import type { ScheduleInput } from './scheduler';
import type { Chain } from './types';

const DAY = 86_400_000;
const now = new Date('2026-11-20T10:00:00Z');

function reviewed(daysAgo: number, score = 0.9): ScheduleInput['fsrs'] {
  return applyReview(emptyFsrs(), score, new Date(now.getTime() - daysAgo * DAY));
}

function node(nodeId: string, daysAgo: number, extra: Partial<ScheduleInput> = {}): ScheduleInput {
  return { nodeId, depth: 3, targetDepth: 3, tier: 'internalize', fsrs: reviewed(daysAgo), practiceCount: 0, ...extra };
}

const chain = (premises: string[], conclusion: string): Chain => ({ id: `${premises.join('+')}>${conclusion}`, premises, conclusion, sources: [] });

describe('scheduler', () => {
  it('maintains only taught ideas a goal still needs beyond recognition', () => {
    expect(isMaintained(node('a', 1))).toBe(true);
    expect(isMaintained(node('a', 1, { depth: 1 }))).toBe(false);
    expect(isMaintained(node('a', 1, { targetDepth: 1 }))).toBe(false);
    expect(isMaintained(node('a', 1, { tier: 'archive' }))).toBe(false);
    expect(isMaintained(node('a', 1, { fsrs: emptyFsrs() }))).toBe(false);
  });

  it('finds due and fading ideas, most faded first', () => {
    const fresh = node('fresh', 0);
    const old = node('old', 60);
    const older = node('older', 120);
    const due = dueNodes([fresh, old, older, node('index', 120, { targetDepth: 1 })], now);
    expect(due.map((d) => d.nodeId)).toEqual(['older', 'old']);
    expect(due.every((d) => d.recall < FADING_RECALL || d.reason === 'due')).toBe(true);
  });

  it('plans back from an exam so recall peaks on the date', () => {
    const recent = node('recent', 3);
    const exam = new Date(now.getTime() + 18 * DAY);
    expect(dueNodes([recent], now)).toHaveLength(0);
    const due = dueNodes([recent], now, exam);
    expect(due[0]?.reason).toBe('exam');
    expect(due[0]?.recallAtExam).toBeLessThan(0.9);
    // outside the window, or reviewed today: not pulled forward
    expect(dueNodes([recent], now, new Date(now.getTime() + 40 * DAY))).toHaveLength(0);
    expect(dueNodes([node('today', 0.2)], now, exam)).toHaveLength(0);
  });

  it('forecasts how many ideas fall due per day', () => {
    const counts = dueForecast([node('a', 60), node('b', 3), node('c', 0)], now, 30);
    expect(counts.reduce((s, c) => s + c, 0)).toBe(3);
    expect(counts[0]).toBe(1); // the overdue one counts today
  });

  it('groups fading ideas that belong together into compound problems', () => {
    // a → c ← b (c needs a and b); d is far away
    const index = indexChains([chain(['a', 'b'], 'c'), chain(['x'], 'd')]);
    const groups = groupForPractice(['a', 'd', 'c', 'b'], index);
    expect(groups).toEqual([['a', 'c', 'b'], ['d']]);
    expect(groupForPractice(['a', 'b', 'c'], index, 4, 2)).toEqual([['a', 'c'], ['b']]); // nearest first
    expect(groupForPractice(['a', 'b', 'c', 'd'], index, 1)).toHaveLength(1);
  });

  it('specifies rung, cue distance and presentation from the group and its practice history', () => {
    const inputs = new Map([node('a', 1), node('b', 1, { practiceCount: 2 }), node('c', 1, { practiceCount: 3 })].map((n) => [n.nodeId, n]));
    expect(specifyProblem(['a'], inputs, 'written_exam')).toMatchObject({ rung: 2, cue: 0 });
    expect(specifyProblem(['a', 'b'], inputs, 'written_exam')).toMatchObject({ rung: 3, cue: 0 });
    expect(specifyProblem(['b', 'c'], inputs, 'written_exam')).toMatchObject({ rung: 4, cue: 2, presentation: 'application' });
    expect(specifyProblem(['a'], inputs, 'outcome').presentation).toBe('application');
  });

  it('makes practice the learner asked for easier or harder than the schedule would', () => {
    const one = { nodeIds: ['a'], rung: 2, cue: 1, presentation: 'application' as const };
    const several = { nodeIds: ['a', 'b'], rung: 3, cue: 0, presentation: 'theory' as const };
    expect(atLevel(one, 'normal')).toEqual(one);
    expect(atLevel(one, 'easier')).toEqual({ nodeIds: ['a'], rung: 1, cue: 0, presentation: 'theory' });
    expect(atLevel(one, 'harder')).toEqual({ nodeIds: ['a'], rung: 2, cue: 2, presentation: 'application' });
    expect(atLevel(several, 'easier')).toMatchObject({ rung: 3, cue: 0, presentation: 'theory' });
    expect(atLevel(several, 'harder')).toMatchObject({ rung: 4, cue: 2, presentation: 'application' });
  });

  it('opens mock exams in the last four weeks before a written exam', () => {
    expect(mockExamsOpen('written_exam', new Date(now.getTime() + 20 * DAY), now)).toBe(true);
    expect(mockExamsOpen('written_exam', new Date(now.getTime() + 40 * DAY), now)).toBe(false);
    expect(mockExamsOpen('oral_exam', new Date(now.getTime() + 20 * DAY), now)).toBe(false);
    expect(mockExamsOpen('written_exam', null, now)).toBe(false);
    const specs = mockExamSpecs([
      { nodeId: 'a', targetDepth: 2, depth: 2 },
      { nodeId: 'b', targetDepth: 4, depth: 3 },
      { nodeId: 'c', targetDepth: 4, depth: 0 },
    ]);
    expect(specs.map((s) => [s.nodeIds[0], s.rung])).toEqual([['b', 4], ['a', 3]]);
  });

  it('chooses consolidate when much depth is fading, build when the edge is open', () => {
    const due = [0.3, 0.4, 0.5, 0.5].map((recall, i) => ({ nodeId: `n${i}`, recall, recallAtExam: null, reason: 'fading' as const }));
    const busy = chooseMode({ due, depthOf: () => 4, fringeLeverage: [1, 0.8], deepenGaps: [], daysToExam: null });
    expect(busy.mode).toBe('consolidate');
    const calm = chooseMode({ due: due.slice(0, 1).map((d) => ({ ...d, recall: 0.84 })), depthOf: () => 2, fringeLeverage: [1, 0.8, 0.5], deepenGaps: [1], daysToExam: null });
    expect(calm.mode).toBe('build');
    const nothingNew = chooseMode({ due: [], depthOf: () => 2, fringeLeverage: [], deepenGaps: [1, 2], daysToExam: null });
    expect(nothingNew.mode).toBe('deepen');
    const examWeek = chooseMode({ due: due.slice(0, 2), depthOf: () => 2, fringeLeverage: [1, 1], deepenGaps: [], daysToExam: 3 });
    expect(examWeek.value.consolidate).toBeGreaterThan(chooseMode({ due: due.slice(0, 2), depthOf: () => 2, fringeLeverage: [1, 1], deepenGaps: [], daysToExam: null }).value.consolidate);
  });

  it('paces a day from hours per week', () => {
    expect(dailyMinutes(null)).toBe(40);
    expect(dailyMinutes(5 * 60)).toBe(60);
    expect(dailyMinutes(60)).toBe(15);
    expect(dailyMinutes(42 * 60)).toBe(360); // cramming: six hours a day, seven days
  });
});

describe('the exam window', () => {
  it('weighs practice up in the last week before the exam, not after it', () => {
    const input = { due: [{ nodeId: 'a', recall: 0.5, recallAtExam: null, reason: 'fading' as const }], depthOf: () => 3, fringeLeverage: [], deepenGaps: [] };
    const before = chooseMode({ ...input, daysToExam: 3 }).value.consolidate;
    const after = chooseMode({ ...input, daysToExam: -30 }).value.consolidate;
    const none = chooseMode({ ...input, daysToExam: null }).value.consolidate;
    expect(before).toBeGreaterThan(none);
    expect(after).toBe(none);
  });
});

describe('contrast problems for misconceptions', () => {
  it('makes an idea due when a misconception about it is still open half a day after it was seen', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    const fsrs = applyReview(emptyFsrs(), 0.9, new Date('2026-11-09T09:00:00Z'));
    const n = (misconceptionSeen: string | null): ScheduleInput => ({ nodeId: 'a', depth: 2, targetDepth: 2, tier: 'internalize', fsrs, practiceCount: 0, misconceptionSeen });
    expect(dueNodes([n(null)], now)).toEqual([]);
    expect(dueNodes([n('2026-11-10T08:00:00Z')], now)).toEqual([]);
    expect(dueNodes([n('2026-11-09T20:00:00Z')], now).map((d) => d.reason)).toEqual(['misconception']);
  });
});
