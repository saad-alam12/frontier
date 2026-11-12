import { describe, expect, it } from 'vitest';
import { recallProbability } from '../core/fsrs';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { openDatabase } from '../store/db';
import { addCapabilities, createGoal, updateGoal } from '../store/goals';
import { getState, listEvidenceForNode } from '../store/evidence';
import { listBugsForNode } from '../store/bugs';
import { getPracticeSet, listProblems } from '../store/practice';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { recordEvidence } from './evidence';
import { refreshGoalFields } from './knowledge';
import { currentPractice, endPracticeSet, goalSchedule, handInExam, missedInPractice, practiceView, resumeGrading, settleGrading, startPractice, submitPracticeAnswer } from './practice';
import type { PracticeDeps } from './practice';
import { todayView } from './today';
import { reviewsByCard } from '../store/cards';
import { saveCard } from './cards';

const DAY = 86_400_000;

/** Writes one problem per spec; the first statement of a composition names an idea unless told not to. */
function fakeGenerator(options: { nameFirst?: boolean } = {}) {
  let first = options.nameFirst ?? false;
  return (req: CompleteRequest<unknown>) => {
    const text = req.messages[0]?.content ?? '';
    const specs = [...text.matchAll(/### Problem (\d+)\nRung: (\d)/g)].map((m) => ({ index: Number(m[1]), rung: Number(m[2]) }));
    const names = [...text.matchAll(/- \[node_[a-z0-9_]+\] ([^(]+) \(/g)].map((m) => (m[1] as string).trim());
    const problems = specs.map((s) => ({
      index: s.index,
      statement: first && s.rung >= 3 ? `Use the ${names[0]} to solve this two-player game with payoffs (3,3), (0,5), (5,0), (1,1).` : `Two firms choose prices; payoffs are (3,3), (0,5), (5,0), (1,1). What happens and why? (problem ${s.index})`,
      solution: 'Each firm undercuts whatever the other does, so both end at (1,1).',
      rubric: ['finds that undercutting is always better', 'concludes (1,1)'],
    }));
    first = false;
    return { problems };
  };
}

function fakeGrader(score: number, misconception: string | null = null) {
  return (req: CompleteRequest<unknown>) => {
    const ids = [...(req.messages[0]?.content ?? '').matchAll(/- \[(node_[a-z0-9_]+)\]/g)].map((m) => m[1] as string);
    return { score, feedback: `Scored ${score}.`, ideas: ids.map((nodeId) => ({ nodeId, score })), misconception: misconception && ids[0] ? { nodeId: ids[0], description: misconception } : null };
  };
}

function setup(gradeScore = 8) {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const id = (key: string) => ids.get(key) as string;
  const now = new Date();
  const goal = createGoal(db, { text: 'Pass the game theory exam', kind: 'course', assessment: 'written_exam', date: null, budget: { mode: 'rate', hours: 5, per: 'week', length: 12, lengthUnit: 'weeks' }, targetGrade: null });
  addCapabilities(db, goal.id, [
    { statement: 'Can find Nash equilibria', targets: [{ nodeId: id('nash'), depth: 3 }, { nodeId: id('bestResponse'), depth: 3 }, { nodeId: id('nashMutualBr'), depth: 3 }] },
    { statement: 'Can use dominance', targets: [{ nodeId: id('dominant'), depth: 2 }, { nodeId: id('pdUnique'), depth: 2 }] },
  ]);
  refreshGoalFields(db);
  // learned two months ago, never reviewed since: fading now
  const longAgo = new Date(now.getTime() - 60 * DAY).toISOString();
  for (const key of ['strategy', 'payoff', 'profile', 'bestResponse', 'nash', 'nashMutualBr', 'dominant']) {
    recordEvidence(db, { nodeId: id(key), kind: 'explain', score: 0.9, reasoning: 'learned', at: longAgo });
  }
  const provider = new FakeProvider({ problemGenerator: fakeGenerator(), grader: fakeGrader(gradeScore) });
  return { db, id, goal, provider, deps: { db, provider } };
}

describe('practice', () => {
  it('builds a compound set over the fading ideas, reveals the solution at once and grades in the background', async () => {
    const { db, id, goal, provider, deps } = setup(8);
    const before = todayView(db);
    const fadingIds = before.fading.map((f) => f.nodeId);
    expect(fadingIds).toEqual(expect.arrayContaining([id('nash'), id('bestResponse'), id('nashMutualBr'), id('dominant')]));
    expect(before.goals[0]?.schedule.mode).toBe('consolidate');
    expect(before.goals[0]?.schedule.modeReason).toMatch(/fading/);

    const set = await startPractice(deps, goal.id);
    expect(set).not.toBeNull();
    // every fading idea of the goal is in some problem, and ideas that belong together share one
    const stored = listProblems(db, set?.id ?? '');
    expect(new Set(stored.flatMap((p) => p.nodeIds))).toEqual(new Set(goalSchedule(db, goal.id).due.map((d) => d.nodeId)));
    expect(stored.length).toBeLessThanOrEqual(4);
    expect(stored.some((p) => p.nodeIds.length > 1 && p.rung === 3)).toBe(true);
    expect(stored.every((p) => p.solution.length > 0 && p.rubric.length >= 2)).toBe(true); // committed before posing
    expect(set?.problems.every((p) => p.solution === null && p.answer === null && p.ideas === null)).toBe(true);
    expect(JSON.stringify(set)).not.toContain('rubric');
    expect(currentPractice(db)?.id).toBe(set?.id);

    const first = set?.problems[0];
    if (!set || !first) throw new Error('no problem');
    const nashBefore = getState(db, id('nash'));
    const revealed = submitPracticeAnswer(deps, first.id, 'Both undercut, so they end at (1,1).', 0.66);
    expect(revealed.problems[0]?.solution).toContain('undercuts');
    expect(revealed.problems[0]?.grade).toBeNull(); // the grade arrives later
    expect(revealed.problems[0]?.ideas?.length).toBeGreaterThan(0);
    expect(revealed.currentIndex).toBe(set.problems.length > 1 ? 1 : null);
    // one attempt only
    submitPracticeAnswer(deps, first.id, 'changed my mind', 0.9);
    await settleGrading();
    const graded = currentPractice(db) ?? (await import('./practice')).practiceView(db, set.id);
    expect(graded.problems[0]?.answer?.text).toBe('Both undercut, so they end at (1,1).');
    expect(graded.problems[0]?.grade).toEqual({ score: 8, feedback: 'Scored 8.' });
    expect(graded.problems[0]?.ideas?.every((i) => i.score === 8)).toBe(true);

    // practice evidence with rung and cue on every idea of the problem, and implicit credit to premises
    const touched = graded.problems[0]?.ideas?.map((i) => i.nodeId) ?? [];
    for (const nodeId of touched) {
      const practice = listEvidenceForNode(db, nodeId).filter((e) => e.kind === 'practice' && !e.context.implicit);
      expect(practice).toHaveLength(1);
      expect(practice[0]?.context.problemId).toBe(first.id);
      expect(practice[0]?.score).toBe(0.8);
    }
    const implicit = ['strategy', 'payoff', 'profile', 'bestResponse'].flatMap((k) => listEvidenceForNode(db, id(k)).filter((e) => e.context.implicit));
    expect(implicit.length).toBeGreaterThan(0);
    // FSRS moved: the practised idea is fresh again
    if (touched.includes(id('nash'))) {
      const after = getState(db, id('nash'));
      expect(recallProbability(after?.fsrs ?? nashBefore!.fsrs, new Date())).toBeGreaterThan(recallProbability(nashBefore!.fsrs, new Date()));
    }

    for (const p of graded.problems.slice(1)) submitPracticeAnswer(deps, p.id, 'They both end at (1,1).', null);
    await settleGrading();
    expect(getPracticeSet(db, set.id)?.status).toBe('done');
    expect(currentPractice(db)).toBeNull();

    // Today reflects it: practised ideas no longer fading
    const after = todayView(db);
    for (const nodeId of touched) expect(after.fading.map((f) => f.nodeId)).not.toContain(nodeId);
    expect(after.fading.length).toBeLessThan(before.fading.length);
    expect(after.week.practised).toBeGreaterThan(0);
    expect(provider.calls.filter((c) => c.role === 'grader')).toHaveLength(set.problems.length);
  });

  it('rejects a composition that names its ideas and asks again', async () => {
    const { goal, provider, deps } = setup();
    provider.script('problemGenerator', fakeGenerator({ nameFirst: true }));
    const set = await startPractice(deps, goal.id);
    expect(set?.problems.some((p) => p.rung >= 3)).toBe(true);
    expect(set?.problems.every((p) => !/Use the /.test(p.statement))).toBe(true);
  });

  it('grades an empty answer as "no idea" without a model call and records misconceptions', async () => {
    const { db, id, goal, provider, deps } = setup();
    provider.script('grader', fakeGrader(2, 'Thinks equilibrium means the best outcome for both.'));
    const set = await startPractice(deps, goal.id);
    if (!set) throw new Error('no set');
    const [a, b] = set.problems;
    if (!a) throw new Error('no problem');
    submitPracticeAnswer(deps, a.id, '   ', null);
    if (b) submitPracticeAnswer(deps, b.id, 'The best outcome for both, (3,3).', 0.9);
    await settleGrading();
    expect(provider.calls.filter((c) => c.role === 'grader')).toHaveLength(b ? 1 : 0);
    const view = (await import('./practice')).practiceView(db, set.id);
    expect(view.problems[0]?.grade?.score).toBe(0);
    if (b) {
      const bugs = (view.problems[1]?.ideas ?? []).flatMap((i) => listBugsForNode(db, i.nodeId));
      expect(bugs.map((x) => x.description)).toContain('Thinks equilibrium means the best outcome for both.');
    }
    expect(id('nash')).toBeTruthy();
  });

  it('plans back from the exam date and opens mock exams in the last four weeks', async () => {
    const { db, goal, deps } = setup();
    const inThreeWeeks = new Date(Date.now() + 20 * DAY).toISOString().slice(0, 10);
    updateGoal(db, goal.id, { date: inThreeWeeks });
    const schedule = goalSchedule(db, goal.id);
    expect(schedule.mockOpen).toBe(true);
    expect(schedule.daysToExam).toBeGreaterThan(18);
    expect(schedule.dailyMinutes).toBe(60);
    const mock = await startPractice(deps, goal.id, { kind: 'mock' });
    expect(mock?.kind).toBe('mock');
    expect(mock?.problems.length).toBeGreaterThan(0);
    expect(mock?.problems.every((p) => p.rung >= 3)).toBe(true);
  });

  it('a card whose fact the answer recalled gets a Good review from practice; a missed one gets nothing', async () => {
    const { db, id, goal, provider, deps } = setup(8);
    const set = await startPractice(deps, goal.id);
    const problem = set?.problems[0];
    if (!set || !problem) throw new Error('no problem');
    const ideas = listProblems(db, set.id)[0]?.nodeIds ?? [];
    const recalled = saveCard(db, { front: 'Define the idea', back: 'Its definition', nodeIds: [ideas[0] ?? id('nash')], goalId: goal.id });
    const missed = saveCard(db, { front: 'Name the idea', back: 'Its name', nodeIds: [ideas[0] ?? id('nash')], goalId: goal.id });
    const grade = fakeGrader(8);
    provider.script('grader', (req: CompleteRequest<unknown>) => ({ ...(grade(req) as object), recalledCards: (req.messages[0]?.content ?? '').includes(recalled.id) ? [recalled.id] : [] }));
    submitPracticeAnswer(deps, problem.id, 'Both undercut, so they end at (1,1).', 0.66);
    await settleGrading();
    expect(reviewsByCard(db).get(recalled.id)).toMatchObject([{ rating: 3, source: 'practice' }]);
    expect(reviewsByCard(db).get(missed.id)).toBeUndefined();
  });

  it('leaving a set closes it without a word about the problems not answered', async () => {
    const { db, goal, deps } = setup(8);
    const set = await startPractice(deps, goal.id);
    if (!set) throw new Error('no set');
    const [first, ...rest] = listProblems(db, set.id);
    if (!first || !rest.length) throw new Error('needs several problems');
    submitPracticeAnswer(deps, first.id, 'Both undercut, so they end at (1,1).', 0.66);
    await settleGrading();
    const untouched = [...new Set(rest.flatMap((p) => p.nodeIds))].filter((nodeId) => !first.nodeIds.includes(nodeId));
    const evidenceBefore = untouched.map((nodeId) => listEvidenceForNode(db, nodeId).length);

    endPracticeSet(db, set.id);
    expect(getPracticeSet(db, set.id)?.status).toBe('done');
    expect(currentPractice(db)).toBeNull(); // Today offers practice again instead of "Continue practice" for good
    expect(untouched.map((nodeId) => listEvidenceForNode(db, nodeId).length)).toEqual(evidenceBefore);
    endPracticeSet(db, set.id); // a second time changes nothing
  });

  it('a grade that failed is tried again when practice is opened, and never twice at once', async () => {
    const { db, goal, provider, deps } = setup(8);
    const set = await startPractice(deps, goal.id);
    const first = set?.problems[0];
    if (!set || !first) throw new Error('no problem');
    const gradesBefore = provider.calls.filter((c) => c.role === 'grader').length;
    let fail = true;
    const errors: string[] = [];
    const flaky: PracticeDeps = {
      db,
      onError: (m) => void errors.push(m),
      provider: { name: 'flaky', complete: <T>(req: CompleteRequest<T>) => (req.role === 'grader' && fail ? Promise.reject(new Error('overloaded')) : provider.complete(req)) },
    };
    submitPracticeAnswer(flaky, first.id, 'Both undercut.', 0.66);
    await settleGrading();
    expect(errors[0]).toContain('tried again when you open practice');
    fail = false;
    resumeGrading(flaky);
    resumeGrading(flaky); // the answer is already being graded: no second call
    await settleGrading();
    expect(provider.calls.filter((c) => c.role === 'grader').length).toBe(gradesBefore + 1);
    expect(listProblems(db, set.id).flatMap((p) => p.nodeIds).some((nodeId) => listEvidenceForNode(db, nodeId).some((e) => e.kind === 'practice' && !e.context.implicit))).toBe(true);
  });

  it('writes problems on the ideas the learner picks, fading or not, at the level they ask for', async () => {
    const { db, id, goal, provider, deps } = setup();
    // fresh again: the schedule has nothing to practise, the learner still can
    for (const key of ['strategy', 'payoff', 'profile', 'bestResponse', 'nash', 'nashMutualBr', 'dominant']) recordEvidence(db, { nodeId: id(key), kind: 'explain', score: 0.9, reasoning: 'again' });
    expect(await startPractice(deps, goal.id)).toBeNull();

    const easier = await startPractice(deps, goal.id, { focus: { nodeIds: [id('dominant')], level: 'easier' } });
    expect(easier?.problems).toHaveLength(1);
    expect(easier?.problems[0]).toMatchObject({ rung: 1, presentation: 'theory' });
    expect(provider.calls.at(-1)?.messages[0]?.content).toContain('Rung: 1, completion');

    const harder = await startPractice(deps, goal.id, { focus: { nodeIds: [id('nash'), id('bestResponse'), id('nashMutualBr')], level: 'harder' } });
    expect(harder?.problems.length).toBeGreaterThan(0);
    expect(harder?.problems.every((p) => p.presentation === 'application' && p.cue === 2 && (p.rung === 4 || p.rung === 2))).toBe(true);
    expect(harder?.problems.some((p) => p.rung === 4)).toBe(true);

    // an idea not learned yet is for a session, not for practice
    const calls = provider.calls.length;
    expect(await startPractice(deps, goal.id, { focus: { nodeIds: [id('pdUnique')] } })).toBeNull();
    expect(provider.calls).toHaveLength(calls);
  });

  it('lists the ideas whose last practice went wrong, until a later problem on them goes right', async () => {
    const { db, id, goal, provider, deps } = setup(3);
    const set = await startPractice(deps, goal.id, { focus: { nodeIds: [id('dominant')] } });
    const problem = set?.problems[0];
    if (!problem) throw new Error('no problem');
    expect(missedInPractice(db, goal.id)).toEqual([]);
    submitPracticeAnswer(deps, problem.id, 'Both cooperate, since that is best for both.', 0.8);
    await settleGrading();
    expect(missedInPractice(db, goal.id).map((m) => m.nodeId)).toEqual([id('dominant')]);

    // practised again on a new problem and passed: off the list
    provider.script('grader', fakeGrader(9));
    // the app turns away a copy of the problem that went wrong, so the variant has to be a new one
    provider.script('problemGenerator', () => ({ problems: [{ index: 0, statement: 'A bidder in a sealed auction weighs bidding 4 or 6 against each rival bid. Which bid should she choose, and why?', solution: 'Bidding 6 is at least as good against every rival bid.', rubric: ['compares the bids against each rival bid', 'chooses 6'] }] }));
    const again = await startPractice(deps, goal.id, { focus: { nodeIds: missedInPractice(db, goal.id).map((m) => m.nodeId) } });
    const second = again?.problems[0];
    if (!second) throw new Error('no second problem');
    expect(provider.calls.filter((c) => c.role === 'problemGenerator').at(-1)?.messages[0]?.content).toContain('Recent problems on these ideas');
    submitPracticeAnswer(deps, second.id, 'Defecting is better whatever the other does, so both defect.', 0.8);
    await settleGrading();
    expect(missedInPractice(db, goal.id)).toEqual([]);
  });

  it('returns null when nothing is fading', async () => {
    const db = openDatabase(':memory:');
    seedExampleGraph(db);
    const goal = createGoal(db, 'Nothing learned yet');
    const provider = new FakeProvider({});
    expect(await startPractice({ db, provider }, goal.id)).toBeNull();
    expect(provider.calls).toHaveLength(0);
  });
});

describe('Today: the time the learner has (R7 A4)', () => {
  it('says what fills 15 to 60 minutes for the lead goal, with the cards due first', () => {
    const { db, id, goal } = setup(8);
    saveCard(db, { front: 'Define a best response', back: 'The best reply to what the others play.', nodeIds: [id('bestResponse')], goalId: goal.id });
    const view = todayView(db);
    expect(view.timePlans.map((p) => p.minutes)).toEqual([15, 30, 45, 60]);
    const half = view.timePlans.find((p) => p.minutes === 30)?.steps ?? [];
    expect(half[0]).toMatchObject({ kind: 'cards', cards: 1 });
    // the goal's ideas are fading, so practice comes before new ideas
    expect(half[1]).toMatchObject({ kind: 'practice', goalId: goal.id });
    expect(view.streak).toBe(0);
  });
});

describe('exam mode (R7 B7)', () => {
  it('a mock exam is timed, shows nothing until it is handed in, then the solutions and a report per skill', async () => {
    const { db, goal, deps } = setup(6);
    const exam = await startPractice(deps, goal.id, { kind: 'mock' });
    expect(exam?.exam).toMatchObject({ over: false, report: null });
    expect(exam?.exam?.minutes).toBe(Math.round(((exam?.problems.length ?? 0) * 12) / 5) * 5);
    const first = exam?.problems[0];
    let view = submitPracticeAnswer(deps, first?.id ?? '', 'Both undercut until (1,1).', 0.66);
    await settleGrading();
    view = practiceView(db, exam?.id ?? '');
    // graded in the background, but nothing shows yet
    expect(view.problems[0]).toMatchObject({ solution: null, grade: null, ideas: null });
    expect(view.problems[0]?.answer?.text).toBe('Both undercut until (1,1).');
    expect(view.currentIndex).toBe(1);

    view = handInExam(db, exam?.id ?? '');
    expect(view.exam?.over).toBe(true);
    expect(view.problems.every((p) => p.solution !== null)).toBe(true);
    expect(view.problems[0]?.grade?.score).toBe(6);
    const report = view.exam?.report;
    expect(report?.answered).toBe(1);
    expect(report?.points).toBe(6);
    expect(report?.skills.some((s) => s.score !== null)).toBe(true);
    // every answer it got is graded, so the exam is done; nothing more can be answered
    expect(view.status).toBe('done');
    expect(() => submitPracticeAnswer(deps, view.problems[1]?.id ?? '', 'late', null)).toThrow('This exam is over');
  });

  it('an exam whose time ran out is no longer in progress on Today', async () => {
    const { goal, deps } = setup(6);
    const exam = await startPractice(deps, goal.id, { kind: 'mock' });
    expect(currentPractice(deps.db)?.id).toBe(exam?.id);
    deps.db.prepare("UPDATE practice_sets SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(exam?.id ?? '');
    expect(currentPractice(deps.db)).toBeNull();
  });
});
