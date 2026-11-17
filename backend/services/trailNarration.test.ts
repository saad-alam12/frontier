import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { openDatabase } from '../store/db';
import type { Database } from '../store/db';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { appendSessionEvent, createSession } from '../store/sessions';
import { MAX_NARRATED_SESSIONS, narrateTrails, trailDigest } from './trailNarration';
import type { Trail, TrailItem } from './trails';

const STORY = { title: 'From best responses to equilibrium', story: 'You began with what a best response is, stumbled on why a profile of them is stable, and by the second session you could say it in your own words.' };

/** A finished session with one stumbled and one good answer on the seed graph, started on `day`. */
function session(db: Database, nodeId: string, title: string, day: string, options: { hints?: number } = {}) {
  const s = createSession(db, null, { plan: { title, orientation: 'Today.', steps: [{ nodeId, name: 'Nash equilibrium' }] }, nodeStatus: { [nodeId]: 'done' } });
  db.prepare('UPDATE sessions SET started_at = ? WHERE id = ?').run(`${day}T09:00:00.000Z`, s.id);
  appendSessionEvent(db, s.id, 'start', {});
  const card = { stage: 'check', question: 'Is (low, low) an equilibrium?', answerKey: 'SECRET KEY yes, neither gains', rubric: ['says yes'] };
  appendSessionEvent(db, s.id, 'card', { nodeId, stage: 'check', card });
  for (let i = 0; i < (options.hints ?? 0); i += 1) appendSessionEvent(db, s.id, 'aside', { nodeId, stage: 'check', mode: 'hint', answer: 'Check each firm in turn.' });
  appendSessionEvent(db, s.id, 'aside', { nodeId, stage: 'check', mode: 'question', question: 'Why does it have to be both firms?', answer: 'Because each is a best response.' });
  appendSessionEvent(db, s.id, 'response', {
    nodeId,
    stage: 'check',
    response: { answer: 'No, a firm could raise its price and earn more.' },
    grade: { score: 0.2, feedback: 'Raising the price loses the sale; check the table again.', misconception: 'thinks a higher price always pays', confidentlyWrong: false, missingBackground: null, recalledCards: [] },
  });
  appendSessionEvent(db, s.id, 'node-done', { nodeId });
  appendSessionEvent(db, s.id, 'finish', {});
  return s.id;
}

describe('trail narration', () => {
  it('builds the digest from what the sessions stored, oldest first, without answer keys', async () => {
    const db = openDatabase(':memory:');
    const nash = seedExampleGraph(db).get('nash') as string;
    const later = session(db, nash, 'Equilibrium again', '2026-11-12');
    const first = session(db, nash, 'Best responses', '2026-11-05', { hints: 2 });
    let digest = '';
    const provider = new FakeProvider({
      librarian: (req: CompleteRequest<unknown>) => {
        digest = req.messages[0]?.content ?? '';
        expect(req.role).toBe('librarian');
        return STORY;
      },
    });
    const told = await narrateTrails({ db, provider }, [later, first]);
    expect(told).toMatchObject({ ...STORY, sessions: 2 });
    expect(digest.indexOf('Best responses')).toBeLessThan(digest.indexOf('Equilibrium again'));
    expect(digest).toContain('## Session 1 · 2026-11-05');
    expect(digest).toContain('Asked the tutor: 2 hints; "Why does it have to be both firms?"');
    expect(digest).toContain('Stumbled:');
    expect(digest).toContain('Nash equilibrium, check: scored 20%. They wrote: "No, a firm could raise its price and earn more."');
    expect(digest).toContain('Misconception noted: thinks a higher price always pays');
    expect(digest).toContain('Ideas finished: Nash equilibrium');
    // what the learner may not see stays out of what the model is told, as in a replay
    expect(digest).not.toContain('SECRET KEY');
  });

  it('leaves out sessions that are gone, says so when none is left, and tells only the latest when there are many', async () => {
    const db = openDatabase(':memory:');
    const nash = seedExampleGraph(db).get('nash') as string;
    const seen: string[] = [];
    const provider = new FakeProvider({
      librarian: (req: CompleteRequest<unknown>) => {
        seen.push(req.messages[0]?.content ?? '');
        return STORY;
      },
    });
    const one = session(db, nash, 'Only one', '2026-11-01');
    expect((await narrateTrails({ db, provider }, [one, 'sess_gone'])).sessions).toBe(1);
    await expect(narrateTrails({ db, provider }, ['sess_gone'])).rejects.toThrow('no longer there');

    const many = Array.from({ length: MAX_NARRATED_SESSIONS + 3 }, (_, i) => session(db, nash, `Session number ${i + 1}`, `2026-10-${String(i + 1).padStart(2, '0')}`));
    const told = await narrateTrails({ db, provider }, many);
    expect(told.sessions).toBe(MAX_NARRATED_SESSIONS);
    const digest = seen.at(-1) ?? '';
    expect(digest).toContain('Session number 23');
    expect(digest).not.toContain('Session number 3\n');
    expect(digest).not.toContain('Session number 1\n');
  });

  it('cuts a long digest to an even share per session, so every session is still told', () => {
    const heavy = (n: number): Trail => {
      const step = (i: number): TrailItem => ({
        id: `e${n}-${i}`,
        at: `2026-10-${String(n).padStart(2, '0')}T09:00:00.000Z`,
        type: 'step',
        idea: `An idea with a long name number ${i}`,
        stage: 'check',
        card: { stage: 'check', question: 'q' } as never,
        asides: [],
        response: { answer: 'a long answer '.repeat(40) },
        grade: { score: 0.1 * i, feedback: 'long feedback '.repeat(40), misconception: 'a misconception '.repeat(20), confidentlyWrong: false, missingBackground: null, recalledCards: [] },
        carried: false,
      });
      return {
        summary: { id: `s${n}`, goalId: null, goalTitle: 'A goal', title: `Heavy session ${n}`, startedAt: `2026-10-${String(n).padStart(2, '0')}T09:00:00.000Z`, endedAt: null, status: 'done', ideas: [], answers: 4, asked: null },
        items: [1, 2, 3, 4].map(step),
      };
    };
    const trails = Array.from({ length: MAX_NARRATED_SESSIONS }, (_, i) => heavy(MAX_NARRATED_SESSIONS - i));
    const digest = trailDigest(trails);
    expect(digest.length).toBeLessThanOrEqual(24_000);
    // oldest first, and the last one is not squeezed out by the first
    expect(digest.indexOf('Heavy session 1\n')).toBeLessThan(digest.indexOf('Heavy session 2\n'));
    for (let n = 1; n <= MAX_NARRATED_SESSIONS; n += 1) expect(digest).toContain(`Heavy session ${n}\n`);
  });
});
