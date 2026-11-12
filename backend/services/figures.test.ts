import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExtractionSchema } from '../agents/extractor';
import { buildStepSchema } from '../agents/tutor';
import { figureRefs, unknownFigureRefs } from '../core/figureRefs';
import { FakeEmbedder } from '../ingest/embedder';
import { fixturePdf } from '../ingest/pdfFixture';
import type { PagePicture, PageRenderer } from '../ingest/pictures';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { saveImageFile } from '../store/attachments';
import { openDatabase } from '../store/db';
import { recordEvidence } from './evidence';
import { describeFigure, figuresForNode, listFigures, setFigurePicture, syncFigurePages } from '../store/figures';
import { addCapabilities, createGoal } from '../store/goals';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { createSource } from '../store/sources';
import { listNodes } from '../store/world';
import { removeSource } from './erase';
import { figureView } from './figures';
import { IngestionService } from './ingestion';
import type { IngestProgress } from './ingestion';
import { refreshGoalFields } from './knowledge';
import { listSourceSummaries } from './library';
import { respond, startSession } from './session';
import { SessionWork } from './sessionWork';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/** Pictures without a browser: a tiny PNG per page, different per page (and per `tag`) so files differ. */
class FakeRenderer implements PageRenderer {
  readonly calls: number[][] = [];
  constructor(
    private readonly options: { fail?: boolean; tag?: string } = {},
  ) {}
  async render(_pdf: Uint8Array, pages: number[]): Promise<PagePicture[]> {
    this.calls.push(pages);
    if (this.options.fail) throw new Error('no window to draw in');
    return pages.map((page) => ({ page, mediaType: 'image/png', bytes: Buffer.concat([PNG, Buffer.from(`${this.options.tag ?? ''}${page}`)]), width: 900, height: 1270 }));
  }
}

/** An extractor that makes one idea per page marker and describes every page picture it is sent, tying it to that page's idea. */
function extractor(req: CompleteRequest<unknown>) {
  const text = req.messages[0]?.content ?? '';
  const pages = [...text.matchAll(/^\[(p\d+(?:–p\d+)?)\]$/gm)].map((m) => m[1] as string);
  const nodes = pages.map((page, i) => ({ tempId: `n${i + 1}`, kind: 'term', name: `Idea on ${page}`, statement: `What ${page} teaches, in a sentence.`, aliases: [], locator: page }));
  const sent = /in this order: ([^.]+)\.|is the picture of this page: ([^.]+)\./.exec(text);
  const pictures = (sent?.[1] ?? sent?.[2] ?? '').split(', ').filter(Boolean);
  const figures = pictures.map((page) => ({ page, shows: `A diagram of boxes joined by arrows on ${page}.`, ideas: [`n${pages.indexOf(page) + 1}`] }));
  return { nodes, chains: [], examples: [], conflicts: [], figures };
}

const LECTURE = fixturePdf([
  { lines: ['Attention lets a model weigh earlier words.', 'Each word scores every other word and takes a weighted mix.'] },
  { picture: 0.9 }, // a scanned page
  { boxes: 8, lines: ['How attention flows'] }, // a diagram
]);

function setup(renderer: PageRenderer | null = new FakeRenderer()) {
  const db = openDatabase(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'frontier-figures-'));
  const provider = new FakeProvider({ extractor, matcher: () => ({ decisions: [] }) });
  const events: IngestProgress[] = [];
  const figuresDir = join(dir, 'figures');
  const service = new IngestionService({ db, provider, embedder: new FakeEmbedder(), sourcesDir: join(dir, 'sources'), renderer: renderer ?? undefined, figuresDir, onProgress: (p) => events.push(p) });
  const file = (name: string, bytes: Uint8Array) => {
    const path = join(dir, name);
    writeFileSync(path, bytes);
    return path;
  };
  return { db, dir, provider, service, events, figuresDir, file };
}

describe('pages that are pictures (B4)', () => {
  it('reads a scan and a diagram from their pictures and keeps them for the tutor, tied to the ideas they show', async () => {
    const renderer = new FakeRenderer();
    const { db, provider, service, figuresDir, file } = setup(renderer);
    const { source } = await service.addFile(file('lecture.pdf', LECTURE));
    expect(listFigures(db, source.id).map((f) => [f.page, f.locator, f.file])).toEqual([
      [2, 'p2', null],
      [3, 'p3', null],
    ]); // pictures are made when the source is read, so adding stays quick
    await service.runSource(source.id);

    expect(renderer.calls).toEqual([[2, 3]]);
    const call = provider.calls.find((c) => c.role === 'extractor');
    expect(call?.images).toHaveLength(2);
    expect(call?.messages[0]?.content).toContain('the pictures of these pages, in this order: p2, p3');
    const figures = listFigures(db, source.id);
    expect(figures.every((f) => f.file && existsSync(join(figuresDir, f.file)))).toBe(true);
    expect(figures[0]?.caption).toBe('A diagram of boxes joined by arrows on p2.');

    const idea = listNodes(db).find((n) => n.name === 'Idea on p2');
    expect(figuresForNode(db, idea?.id ?? '').map((f) => f.locator)).toEqual(['p2']);
    expect(listSourceSummaries(db)[0]?.pictures).toBe(2);
    const view = figureView(db, figuresDir, figures[0]?.id ?? '');
    expect(view.where).toBe('lecture, p2');
    expect(view.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('a scan with no text is read when pictures can be made, and refused with a plain reason when not', async () => {
    const scan = fixturePdf([{ picture: 0.95 }, { picture: 0.95 }]);
    const without = setup(null);
    await expect(without.service.addFile(without.file('scan.pdf', scan))).rejects.toThrow('scan.pdf has no text to read: it looks like a scan or pictures of pages, which only the app can read.');
    const withPictures = setup();
    const { source } = await withPictures.service.addFile(withPictures.file('scan.pdf', scan));
    expect((await withPictures.service.runSource(source.id)).status).toBe('done');
    expect(listNodes(withPictures.db).map((n) => n.name).sort()).toEqual(['Idea on p1', 'Idea on p2']);
  });

  it('when pictures cannot be made, the source is read from its text and says why', async () => {
    const { db, provider, service, events, file } = setup(new FakeRenderer({ fail: true }));
    const { source } = await service.addFile(file('lecture.pdf', LECTURE));
    expect((await service.runSource(source.id)).status).toBe('done');
    expect(events.some((e) => e.message?.startsWith('Pictures of the pages that are mostly figures could not be made'))).toBe(true);
    expect(provider.calls.find((c) => c.role === 'extractor')?.images).toEqual([]);
    expect(listFigures(db, source.id).every((f) => f.file === null)).toBe(true);
  });

  it('reading a source again keeps its pictures instead of making them again', async () => {
    const renderer = new FakeRenderer();
    const { db, service, file } = setup(renderer);
    const { source } = await service.addFile(file('lecture.pdf', LECTURE));
    await service.runSource(source.id);
    const before = listFigures(db, source.id).map((f) => f.file);
    await service.prepareReread(source.id);
    await service.runSource(source.id);
    expect(renderer.calls).toHaveLength(1);
    expect(listFigures(db, source.id).map((f) => f.file)).toEqual(before);
  });

  it('sends back an extraction that skips a page picture or names one it was not sent', () => {
    const schema = buildExtractionSchema(new Set(), ['p2', 'p3']);
    const base = { nodes: [{ tempId: 'n1', kind: 'term', name: 'Attention', statement: 'Each word weighs every other.' }] };
    const one = { page: 'p2', shows: 'A diagram of the encoder.', ideas: ['n1'] };
    expect(schema.safeParse({ ...base, figures: [one] }).error?.issues[0]?.message).toBe('describe every page picture once; missing: p3');
    expect(schema.safeParse({ ...base, figures: [one, { ...one, page: 'p9' }] }).success).toBe(false);
    expect(schema.safeParse({ ...base, figures: [one, { ...one, page: 'p3', ideas: ['n7'] }] }).success).toBe(false);
    expect(schema.safeParse({ ...base, figures: [one, { ...one, page: 'p3', ideas: [] }] }).success).toBe(true);
  });

  it('removing a source deletes its pictures, but not one another source still uses', async () => {
    const { db, service, figuresDir, file } = setup();
    const a = await service.addFile(file('a.pdf', LECTURE));
    const b = await service.addFile(file('b.pdf', fixturePdf([{ lines: ['Another lecture'] }, { picture: 0.9 }])));
    await service.runSource(a.source.id);
    await service.runSource(b.source.id);
    // both sources have a picture of their page 2: the fake draws the same bytes, so it is one file
    expect(readdirSync(figuresDir)).toHaveLength(2);
    const deps = { db, sourcesDir: join(figuresDir, '..', 'sources'), figuresDir };
    removeSource(deps, a.source.id);
    expect(readdirSync(figuresDir)).toHaveLength(1); // p3 was only a's; p2 is still b's
    removeSource(deps, b.source.id);
    expect(readdirSync(figuresDir)).toHaveLength(0);
  });
});

describe('figures in a session (B4)', () => {
  it('the tutor is told about the figures of the idea, sees their pictures when it explains, and may show only those', async () => {
    const db = openDatabase(':memory:');
    const ids = seedExampleGraph(db);
    for (const key of ['strategy', 'payoff']) recordEvidence(db, { nodeId: ids.get(key) as string, kind: 'explain', score: 0.95, reasoning: 't' });
    const goal = createGoal(db, 'Pass the game theory exam');
    const profile = ids.get('profile') as string;
    addCapabilities(db, goal.id, [{ statement: 'Can say what a profile is', targets: [{ nodeId: profile, depth: 1 }] }]);
    refreshGoalFields(db);
    const figuresDir = join(mkdtempSync(join(tmpdir(), 'frontier-figures-')), 'figures');
    const source = createSource(db, { kind: 'pdf', title: 'Lecture 2', path: null, hash: 'h1' }, [{ text: '[p4]\n', locator: 'p4' }]);
    syncFigurePages(db, source.id, [{ page: 4, locator: 'p4' }]);
    const figure = listFigures(db, source.id)[0]!;
    setFigurePicture(db, figure.id, { file: saveImageFile(figuresDir, PNG, 'image/png'), width: 900, height: 1270 });
    describeFigure(db, figure.id, 'A table of three players and their chosen strategies.', [profile]);

    const sent: CompleteRequest<unknown>[] = [];
    const card = (markdown: string) => ({ grade: null, card: { stage: 'index', gist: markdown, placement: 'Under Nash.', question: 'What is a profile?', answerKey: 'one strategy each' } });
    const provider = new FakeProvider({
      planner: () => ({ title: 'Profiles', orientation: 'Today: profiles.', steps: [{ nodeId: profile, why: 'needed' }] }),
      tutor: [
        (req: CompleteRequest<unknown>) => (sent.push(req), card('A profile, as in ![The table](figure:fig_madeup).')),
        card(`A profile lists one strategy per player.\n\n![The table of players](figure:${figure.id})`),
      ],
    });
    const deps = { db, provider, work: new SessionWork(), figuresDir };
    const started = await startSession(deps, goal.id);
    const snap = await respond(deps, started.id, { answer: '' }); // past the orientation, to the first card
    const text = sent[0]?.messages[0]?.content ?? '';
    expect(text).toContain('## Figures you can show');
    expect(text).toContain(`- [${figure.id}] Lecture 2, p4: A table of three players`);
    expect(text).toContain(`The first image attached is the picture of figure ${figure.id}.`);
    expect(sent[0]?.messages[0]?.images).toHaveLength(1);
    const tutorCalls = provider.calls.filter((c) => c.role === 'tutor');
    expect(tutorCalls).toHaveLength(1); // the made-up figure was sent back and the second try accepted
    expect(snap.card).toMatchObject({ stage: 'index' });
    expect(JSON.stringify(snap.card)).toContain(`figure:${figure.id}`);
  });

  it('finds figure references in any text of a card', () => {
    expect(figureRefs('See ![a](figure:fig_a1) and ![b](figure:fig_b2).')).toEqual(['fig_a1', 'fig_b2']);
    expect(unknownFigureRefs({ question: '![x](figure:fig_x)', rubric: ['![y](figure:fig_y)'] }, new Set(['fig_y']))).toEqual(['fig_x']);
    const schema = buildStepSchema('explain', false, new Set(), new Set(['fig_ok']));
    expect(schema.safeParse({ grade: null, card: { stage: 'explain', markdown: '![t](figure:fig_ok)' } }).success).toBe(true);
    expect(schema.safeParse({ grade: null, card: { stage: 'explain', markdown: '![t](figure:fig_no)' } }).error?.issues[0]?.message).toContain('figure:fig_no is not one of the figures listed (fig_ok)');
  });
});
