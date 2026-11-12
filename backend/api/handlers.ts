import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ASIDE_MODES } from '../agents/tutor';
import { activeSession } from '../store/sessions';
import { z } from 'zod';
import { writeFile } from 'node:fs/promises';
import { app, dialog, ipcMain, net, shell } from 'electron';
import { basename, join } from 'node:path';
import { cheatSheetView, exportGoalNotes, goalNotesView, NOTE_CHARS, noteFor, saveNote } from '../services/notes';
import { notesPdfName } from '../core/notes';
import { editIdea, mergeCandidates, mergeIdeas, NAME_CHARS, STATEMENT_CHARS } from '../services/mapEdit';
import { weekReview } from '../services/weekReview';
import { misconceptionsView } from '../services/misconceptions';
import { dismissMisconception } from '../services/bugs';
import type { ApiEvents, ApiInput, ApiMethods, ApiName, ApiOutput, EventName, MakerView, MaterialCandidate, SourceSummary } from './contract';
import { EVENT_CHANNEL, IPC_CHANNEL } from './contract';
import type { AppContext } from '../context';
import { getSource } from '../store/sources';
import { SettingsPatchSchema, modelOptions } from '../settings/schema';
import { runConnectionTest } from '../agents/connectionTest';
import { isCancelled } from '../llm/provider';
import { SUPPORTED_EXTENSIONS } from '../ingest/readers';
import { addLink, addPastedText, deltaForSource, listSourceSummaries, readSourceAgain } from '../services/library';
import { approveGoalPlan, createGoalFromForm, goDeeper, goalDetail, guessRole, setGoalStatus, updateGoalFromForm, useFreedTime } from '../services/goals';
import { previewPlan } from '../services/budget';
import { tick } from '../services/activity';
import { statsView } from '../services/stats';
import { cancelProbe, createProbe, openProbe, submitProbe } from '../services/probe';
import { planSession } from '../services/planner';
import { abandonSession, currentSession, pauseSession, respond, startSession, askTutor, ASIDE_MAX_CHARS } from '../services/session';
import { previewFree, startFreeSession } from '../services/freeSession';
import { refreshGoalFields } from '../services/knowledge';
import { currentPractice, endPracticeSet, handInExam, practiceView, resumeGrading, startPractice, submitPracticeAnswer } from '../services/practice';
import { todayView } from '../services/today';
import { mapView, nodeCard } from '../services/map';
import { EraseRequestSchema, eraseFromMap, previewErase, removeSource } from '../services/erase';
import { MAX_TURNS, lookup, openCard } from '../services/lookup';
import { listTrails, trail } from '../services/trails';
import { deleteGoal, listGoals, requestRemap, startUnverified } from '../store/goals';
import { getProbeSet } from '../store/probes';
import { getSession } from '../store/sessions';
import { approveRemap, dismissRemap, remapView } from '../services/remap';
import { additionView, applyAddition, dismissAddition, requestAddition } from '../services/addition';
import { getDrafts, setDraft } from '../store/drafts';
import { attachmentDataUrl, saveAttachment } from '../store/attachments';
import { MAX_CODE_CHARS } from '../core/code';
import { FigureRequestSchema, figureView } from '../services/figures';
import { usageView } from '../services/usage';
import { answerDialogue, dialogueView, endDialogue, openDialogueView, startDialogue } from '../services/dialogue';
import { ReviewInputSchema, cardPreferences, cardQueue, cardStats, cardSummary, draftFor, findIdeas, goalCardSettings, listCardViews, removeCard, reviewCard, saveCard, saveCardPreferences, saveGoalCards, suspendCard, undoReview } from '../services/cards';

const execFileAsync = promisify(execFile);
const CodeRunSchema = z.object({ source: z.string().max(MAX_CODE_CHARS, 'The code is too long to run.'), key: z.string().min(1).max(80) });
const CodeInstallSchema = z.object({ package: z.string().min(1).max(100), key: z.string().min(1).max(80) });

type Handlers = { [N in ApiName]: (input: ApiInput<N>) => Promise<ApiOutput<N>> | ApiOutput<N> };

export function buildHandlers(ctx: AppContext): Handlers {
  /** Screens that count or list cards (the sidebar, Today, a goal page) refresh on this. */
  const cardsChanged = (goalId: string | null) => ctx.emit('cards.changed', { goalId });
  const detail = (goalId: string) => {
    const d = goalDetail(ctx.db(), goalId, ctx.goalWorker().status(goalId));
    if (!d) throw new Error('unknown goal');
    return d;
  };
  const dialogueDeps = () => ({ db: ctx.db(), provider: ctx.provider(), onWriting: (dialogueId: string, text: string) => ctx.emit('dialogue.writing', { dialogueId, text }) });
  /** Add files to the library unread and guess what each is for; reading starts once a goal uses them. */
  const addMaterials = async (paths: string[]): Promise<MaterialCandidate[]> => {
    const out: MaterialCandidate[] = [];
    const failed: string[] = [];
    for (const path of paths) {
      try {
        const { source, existed } = await ctx.ingestion().addFile(path);
        const guess = await guessRole(ctx.db(), ctx.provider(), source.id).catch(() => ({ role: 'teaching' as const, reason: 'Could not tell; assumed teaching material.' }));
        out.push({ sourceId: source.id, title: source.title, role: guess.role, reason: guess.reason, existed });
      } catch (error) {
        // one file that cannot be read must not cost the learner the others
        failed.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (failed.length && out.length === 0) throw new Error(failed.join(' '));
    if (failed.length) ctx.emit('app.toast', { kind: 'error', message: failed.join(' ') });
    return out;
  };
  /** Files for the Library, from the dialog or dropped on the window: each is added and its reading starts. */
  const addFiles = async (paths: string[]): Promise<{ added: SourceSummary[]; skipped: string[] }> => {
    const added: string[] = [];
    const skipped: string[] = [];
    for (const path of paths) {
      try {
        const { source, existed } = await ctx.ingestion().addFile(path);
        if (existed) skipped.push(`${basename(path)} is already in the library.`);
        else added.push(source.id);
        if (source.status !== 'done') ctx.ingestion().start(source.id);
      } catch (error) {
        skipped.push(error instanceof Error ? error.message : String(error));
      }
    }
    return { added: listSourceSummaries(ctx.db(), ctx.ingestion()).filter((s) => added.includes(s.id)), skipped };
  };
  return {
    'app.info': () => ({ version: ctx.version, dataFolder: ctx.settings.get().dataFolder, settingsFile: ctx.settingsFile }),
    'app.showLog': () => {
      ctx.log.touch();
      shell.showItemInFolder(ctx.log.path);
      return null;
    },
    'backups.list': () => ctx.backups(),
    'backups.create': () => ctx.backupNow(),
    'backups.restore': ({ file }) => {
      ctx.restoreBackup(z.string().parse(file));
      return null;
    },
    'backups.showFolder': async () => {
      await shell.openPath(ctx.paths().backups);
      return null;
    },
    'settings.get': () => ctx.settings.get(),
    'settings.update': (patch) => {
      const previous = ctx.settings.get();
      const next = ctx.settings.update(SettingsPatchSchema.parse(patch));
      ctx.onSettingsChanged(previous);
      return next;
    },
    'settings.modelOptions': () => modelOptions(),
    'settings.testConnection': () => runConnectionTest(ctx.provider()),
    'settings.chooseFolder': async () => {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    'library.list': () => listSourceSummaries(ctx.db(), ctx.ingestion()),
    'library.addText': async (input) => {
      const { source, existed } = await addPastedText(ctx.ingestion(), input);
      return { sourceId: source.id, existed };
    },
    // the system's own network stack, so a proxy set on the computer applies
    'library.addLink': ({ url }) => addLink({ ingestion: ctx.ingestion(), fetcher: (address, init) => net.fetch(address, init), userAgent: `Frontier/${ctx.version}` }, z.string().max(2000).parse(url)),
    'library.addFiles': async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Sources', extensions: SUPPORTED_EXTENSIONS }],
      });
      return addFiles(result.canceled ? [] : result.filePaths);
    },
    'library.addPaths': async ({ paths }) => {
      const result = await addFiles(z.array(z.string()).max(200).parse(paths));
      // dropped anywhere on the window: the Library may not be the screen that is open
      if (result.skipped.length) ctx.emit('app.toast', { kind: 'error', message: result.skipped.join(' ') });
      return result;
    },
    'library.stop': ({ sourceId }) => {
      ctx.ingestion().stop(sourceId);
      return undefined;
    },
    'library.openOriginal': async ({ sourceId }) => {
      const stored = getSource(ctx.db(), sourceId)?.path;
      if (!stored) throw new Error('This source has no file: it was pasted or comes from a session.');
      // shell.openPath answers with a message when it fails, and with nothing when the file opened
      const problem = await shell.openPath(join(ctx.paths().sources, stored));
      if (problem) throw new Error('The stored copy of this source could not be opened.');
      return null;
    },
    'library.run': ({ sourceId }) => {
      ctx.ingestion().start(sourceId);
      return undefined;
    },
    'library.reread': ({ sourceId }) => readSourceAgain(ctx.db(), ctx.ingestion(), sourceId),
    'library.remove': ({ sourceId }) => {
      removeSource({ db: ctx.db(), sourcesDir: ctx.paths().sources, figuresDir: ctx.paths().figures, isReading: (id) => ctx.ingestion().isRunning(id) }, sourceId);
      return undefined;
    },
    'library.delta': ({ sourceId }) => deltaForSource(ctx.db(), sourceId),
    'goals.list': () => listGoals(ctx.db()).map((g) => detail(g.id)),
    'goals.get': ({ goalId }) => detail(goalId),
    'goals.exportNotes': async ({ goalId }) => {
      const { fileName, markdown } = exportGoalNotes(ctx.db(), goalId);
      const result = await dialog.showSaveDialog({ defaultPath: join(app.getPath('documents'), fileName), filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (result.canceled || !result.filePath) return { path: null };
      await writeFile(result.filePath, markdown, 'utf8');
      return { path: result.filePath };
    },
    'notes.goal': ({ goalId }) => goalNotesView(ctx.db(), String(goalId)),
    'notes.sheet': ({ goalId, all }) => cheatSheetView(ctx.db(), String(goalId), { all: all === true }),
    'notes.idea': ({ nodeId }) => ({ note: noteFor(ctx.db(), String(nodeId)) }),
    'notes.saveIdea': ({ nodeId, text }) => saveNote(ctx.db(), String(nodeId), z.string().max(NOTE_CHARS, `A note can be at most ${NOTE_CHARS} characters.`).parse(text)),
    'notes.print': async () => {
      const window = ctx.window();
      if (!window) return { printed: false };
      const printed = await new Promise<boolean>((resolve) => window.webContents.print({}, (success) => resolve(success)));
      return { printed };
    },
    'notes.savePdf': async ({ goalId, kind }) => {
      const window = ctx.window();
      if (!window) return { path: null };
      const title = goalNotesView(ctx.db(), String(goalId)).title;
      const base = notesPdfName(title, z.enum(['notes', 'sheet']).parse(kind));
      const result = await dialog.showSaveDialog(window, { defaultPath: join(app.getPath('documents'), base), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (result.canceled || !result.filePath) return { path: null };
      const pdf = await window.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { top: 0.5, bottom: 0.5, left: 0.55, right: 0.55 } });
      await writeFile(result.filePath, pdf);
      return { path: result.filePath };
    },
    'goals.create': ({ form, draft }) => {
      const goal = createGoalFromForm(ctx.db(), { ...form, text: form.text.trim() }, { draft });
      ctx.goalWorker().refresh(goal.id);
      return detail(goal.id);
    },
    'goals.update': ({ goalId, form }) => {
      updateGoalFromForm(ctx.db(), goalId, form);
      ctx.goalWorker().refresh(goalId);
      return detail(goalId);
    },
    'goals.useFreedTime': ({ goalId }) => {
      useFreedTime(ctx.db(), goalId);
      ctx.emit('goals.changed', { goalId });
      return detail(goalId);
    },
    'goals.setStatus': ({ goalId, status }) => {
      setGoalStatus(ctx.db(), goalId, z.enum(['active', 'paused', 'done']).parse(status));
      ctx.emit('goals.changed', { goalId });
      return detail(goalId);
    },
    'goals.preview': ({ goalId, budget }) => previewPlan(ctx.db(), goalId, budget),
    'goals.approve': ({ goalId }) => {
      approveGoalPlan(ctx.db(), goalId);
      return detail(goalId);
    },
    'goals.remove': ({ goalId }) => {
      if (activeSession(ctx.db())?.goalId === goalId) throw new Error('A session on this goal is open. End or finish it first, then remove the goal.');
      deleteGoal(ctx.db(), goalId);
      refreshGoalFields(ctx.db());
      return undefined;
    },
    'goals.goDeeper': ({ goalId, nodeIds }) => {
      if (currentSession(ctx.db())) throw new Error('Finish or end the open session first, then go deeper.');
      return goDeeper(ctx.db(), goalId, nodeIds);
    },
    'goals.remapView': ({ goalId }) => remapView(ctx.db(), goalId),
    'goals.remapApprove': ({ goalId }) => {
      approveRemap(ctx.db(), goalId);
      return detail(goalId);
    },
    'goals.remapDismiss': ({ goalId }) => {
      dismissRemap(ctx.db(), goalId);
      return detail(goalId);
    },
    'goals.remapRequest': ({ goalId }) => {
      requestRemap(ctx.db(), goalId);
      ctx.goalWorker().refresh(goalId);
      return detail(goalId);
    },
    'goals.compile': async ({ goalId }) => {
      await ctx.goalWorker().compileNow(goalId);
      return detail(goalId);
    },
    'goals.additionRequest': ({ goalId, request }) => {
      requestAddition(ctx.db(), goalId, request);
      ctx.goalWorker().refresh(goalId);
      return detail(goalId);
    },
    'goals.additionView': ({ goalId }) => additionView(ctx.db(), goalId),
    'goals.additionApprove': ({ goalId }) => {
      applyAddition(ctx.db(), goalId);
      ctx.goalWorker().refresh(goalId); // a re-map held back while the addition waited may run now
      return detail(goalId);
    },
    'goals.additionDismiss': ({ goalId }) => {
      dismissAddition(ctx.db(), goalId);
      ctx.goalWorker().refresh(goalId);
      return detail(goalId);
    },
    'goals.startUnverified': ({ goalId, nodeId }) => {
      startUnverified(ctx.db(), goalId, nodeId);
      return detail(goalId);
    },
    'materials.pick': async () => {
      const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Sources', extensions: SUPPORTED_EXTENSIONS }] });
      return result.canceled ? [] : addMaterials(result.filePaths);
    },
    'materials.addPaths': ({ paths }) => addMaterials(paths),
    'probe.create': ({ goalId }) => createProbe(ctx.db(), ctx.provider(), goalId),
    'probe.open': ({ goalId }) => openProbe(ctx.db(), goalId),
    'probe.submit': async ({ probeId, answers }) => {
      const outcomes = await submitProbe(ctx.db(), ctx.provider(), probeId, answers);
      const goalId = getProbeSet(ctx.db(), probeId)?.goalId;
      if (goalId) ctx.goalWorker().refresh(goalId); // missing background may call for a new map
      return outcomes;
    },
    'probe.cancel': ({ probeId }) => cancelProbe(probeId),
    'plan.preview': ({ goalId }) => planSession(ctx.db(), ctx.provider(), goalId),
    'session.current': () => currentSession(ctx.db(), ctx.sessionWork),
    'session.work': () => ctx.sessionWork.current(),
    'session.start': ({ goalId, focus, minutes }) => startSession(ctx.practiceDeps(), goalId, focus, minutes === undefined ? undefined : Math.max(10, Math.min(90, Math.round(Number(minutes) || 45)))),
    'session.respond': async ({ sessionId, response, draftKey }) => {
      const snap = await respond(ctx.practiceDeps(), sessionId, response, { draftKey });
      if (snap.status !== 'active' && snap.goalId) ctx.goalWorker().refresh(snap.goalId); // a finished session may call for a new map
      return snap;
    },
    'session.ask': ({ sessionId, mode, question }) => askTutor(ctx.practiceDeps(), sessionId, { mode: z.enum(ASIDE_MODES).parse(mode), question: z.string().max(ASIDE_MAX_CHARS).optional().parse(question) }),
    'session.cancel': ({ sessionId }) => ctx.sessionWork.cancel(sessionId),
    'session.dismissStart': () => {
      ctx.sessionWork.dismissStart();
      return undefined;
    },
    'session.freePreview': (choice) => previewFree(ctx.db(), ctx.sessionMaker, choice),
    'session.make': (request) => {
      // the call goes on in the background; its result arrives as an event and waits as a proposal
      void ctx.sessionMaker.make({ db: ctx.db(), provider: ctx.provider(), embedder: ctx.embedder(), ingestion: ctx.ingestion() }, request);
      return ctx.sessionMaker.current() as MakerView;
    },
    'session.maker': () => ctx.sessionMaker.current(),
    'session.startFree': (choice) => startFreeSession(ctx.practiceDeps(), ctx.sessionMaker, choice),
    'session.pause': ({ sessionId }) => {
      pauseSession(ctx.db(), sessionId);
      return undefined;
    },
    'session.end': async ({ sessionId }) => {
      const goalId = getSession(ctx.db(), sessionId)?.goalId;
      await abandonSession(ctx.practiceDeps(), sessionId);
      if (goalId) ctx.goalWorker().refresh(goalId); // the session may have shown missing background
      return undefined;
    },
    'today.view': () => todayView(ctx.db()),
    'practice.current': () => currentPractice(ctx.db()),
    'practice.get': ({ setId }) => {
      // a grade that failed earlier is tried again whenever the learner comes back to practice
      resumeGrading(ctx.practiceDeps());
      return practiceView(ctx.db(), setId);
    },
    'practice.end': ({ setId }) => {
      endPracticeSet(ctx.db(), setId);
      return null;
    },
    'practice.start': ({ goalId, kind, nodeIds, level, problems }) =>
      startPractice(ctx.practiceDeps(), goalId, {
        kind,
        maxProblems: problems === undefined ? undefined : z.number().int().min(1).max(8).parse(problems),
        focus: nodeIds?.length ? { nodeIds: z.array(z.string()).max(40).parse(nodeIds), level: z.enum(['easier', 'normal', 'harder']).optional().parse(level) } : undefined,
      }),
    'practice.handIn': ({ setId }) => handInExam(ctx.db(), String(setId)),
    'dialogue.start': ({ goalId, kind }) => startDialogue(dialogueDeps(), String(goalId), z.enum(['oral', 'teach']).parse(kind)),
    'dialogue.get': ({ dialogueId }) => dialogueView(ctx.db(), String(dialogueId)),
    'dialogue.open': ({ goalId }) => openDialogueView(ctx.db(), String(goalId)),
    'dialogue.answer': ({ dialogueId, answer }) => answerDialogue(dialogueDeps(), String(dialogueId), z.string().max(12_000, 'The answer is too long.').parse(answer)),
    'dialogue.end': ({ dialogueId }) => endDialogue(dialogueDeps(), String(dialogueId)),
    'practice.submit': ({ problemId, answer, confidence, code, attachments, quote }) => submitPracticeAnswer(ctx.practiceDeps(), problemId, answer, confidence, { code, attachments, quote }),
    'code.run': (input) => {
      const { source, key } = CodeRunSchema.parse(input);
      return ctx.codeRunner().run(source, key);
    },
    'code.stop': ({ key }) => ({ stopped: ctx.codeRunner().stop(String(key)) }),
    'code.install': (input) => {
      const { package: pkg, key } = CodeInstallSchema.parse(input);
      return ctx.codeRunner().install(pkg, key);
    },
    'code.python': async ({ lookAgain }) => {
      if (lookAgain) ctx.codeRunner().lookAgain();
      return ctx.codeRunner().info();
    },
    'code.installPython': async () => {
      if (process.platform !== 'darwin') throw new Error('Install Python 3 for your system, then press Run again.');
      await execFileAsync('xcode-select', ['--install']).catch(() => undefined);
      return { message: "Apple's installer is open. When it has finished, press Run again." };
    },
    'map.view': () => mapView(ctx.db()),
    'map.card': ({ nodeId }) => nodeCard(ctx.db(), nodeId),
    'map.erasePreview': (request) => previewErase(ctx.db(), EraseRequestSchema.parse(request)),
    'map.erase': (request) => {
      const result = eraseFromMap({ db: ctx.db(), sourcesDir: ctx.paths().sources, figuresDir: ctx.paths().figures, isReading: (id) => ctx.ingestion().isRunning(id) }, EraseRequestSchema.parse(request));
      for (const goalId of result.goalsToMap) ctx.goalWorker().refresh(goalId); // goals left with no map are mapped again
      return result;
    },
    'map.editIdea': (input) => {
      const { nodeId, name, statement } = z.object({ nodeId: z.string().min(1), name: z.string().max(NAME_CHARS * 2), statement: z.string().max(STATEMENT_CHARS * 2) }).parse(input);
      const result = editIdea(ctx.db(), nodeId, { name, statement });
      // matching and Lookup read the idea by meaning: its embedding follows the new text
      if (result.changed) void ctx.ingestion().ensureEmbeddings().catch(() => undefined);
      return result;
    },
    'map.mergeCandidates': ({ nodeId, query }) => mergeCandidates(ctx.db(), String(nodeId), z.string().max(200).optional().parse(query)),
    'map.mergeIdeas': (input) => {
      const { keepId, dropId } = z.object({ keepId: z.string().min(1), dropId: z.string().min(1) }).parse(input);
      return mergeIdeas(ctx.db(), keepId, dropId);
    },
    'lookup.search': (input) => {
      const { query, history } = z.object({ query: z.string().trim().min(1).max(500), history: z.array(z.object({ question: z.string().max(500), answer: z.string().max(4000) })).max(MAX_TURNS * 2).optional() }).parse(input);
      return lookup({ db: ctx.db(), provider: ctx.provider(), embedder: ctx.embedder(), ingestion: ctx.ingestion() }, query, history);
    },
    'lookup.open': ({ nodeId }) => openCard(ctx.db(), nodeId),
    'trails.list': ({ nodeId }) => listTrails(ctx.db(), nodeId),
    'trails.get': ({ sessionId }) => trail(ctx.db(), sessionId),
    'activity.tick': (input) => {
      tick(ctx.db(), input);
      return undefined;
    },
    'stats.view': (filter) => statsView(ctx.db(), filter),
    'stats.misconceptions': () => misconceptionsView(ctx.db()),
    'stats.dismissMisconception': ({ bugId }) => {
      dismissMisconception(ctx.db(), z.string().min(1).parse(bugId));
      return misconceptionsView(ctx.db());
    },
    'stats.week': ({ weekOf }) => weekReview(ctx.db(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().parse(weekOf ?? null)),
    'drafts.get': ({ keys }) => getDrafts(ctx.db(), keys),
    'drafts.set': ({ key, value }) => {
      setDraft(ctx.db(), key, value);
      return undefined;
    },
    'attachments.save': (upload) => ({ name: saveAttachment(ctx.paths().attachments, upload) }),
    'attachments.read': ({ name }) => attachmentDataUrl(ctx.paths().attachments, name),
    'settings.usage': () => usageView(ctx.db()),
    'figures.read': (input) => figureView(ctx.db(), ctx.paths().figures, FigureRequestSchema.parse(input).figureId),
    'cards.queue': ({ goalId }) => cardQueue(ctx.db(), goalId),
    'cards.review': (input) => {
      const { cardId, rating } = ReviewInputSchema.parse(input);
      reviewCard(ctx.db(), cardId, rating);
      cardsChanged(null);
      return cardQueue(ctx.db(), input.goalId);
    },
    'cards.undoReview': ({ cardId, goalId }) => {
      undoReview(ctx.db(), z.string().parse(cardId));
      cardsChanged(null);
      return cardQueue(ctx.db(), goalId, new Date(), cardId);
    },
    'cards.list': (filter) => listCardViews(ctx.db(), filter),
    'cards.save': (input) => {
      const card = saveCard(ctx.db(), input);
      cardsChanged(card.goalId);
      return card;
    },
    'cards.delete': ({ cardId }) => {
      removeCard(ctx.db(), cardId);
      cardsChanged(null);
      return undefined;
    },
    'cards.suspend': ({ cardId, suspended }) => {
      const card = suspendCard(ctx.db(), cardId, suspended);
      cardsChanged(card.goalId);
      return card;
    },
    'cards.draft': (request) => draftFor({ db: ctx.db(), provider: ctx.provider() }, request),
    'cards.findIdeas': ({ query }) => findIdeas(ctx.db(), query),
    'cards.summary': ({ goalId }) => cardSummary(ctx.db(), goalId),
    'cards.goalSettings': ({ goalId }) => goalCardSettings(ctx.db(), goalId),
    'cards.saveGoalSettings': ({ goalId, settings }) => saveGoalCards(ctx.db(), goalId, settings),
    'cards.preferences': () => cardPreferences(ctx.db()),
    'cards.savePreferences': (prefs) => saveCardPreferences(ctx.db(), { withoutGoal: prefs.withoutGoal === true }),
    'cards.stats': (filter) => cardStats(ctx.db(), filter),
  };
}

/** Transport only: route every invoke to its handler and wrap errors as plain data. */
export function registerIpc(ctx: AppContext, fromApp: (url: string) => boolean): void {
  const handlers = buildHandlers(ctx);
  ipcMain.handle(IPC_CHANNEL, async (event, name: string, input: unknown) => {
    // only the app's own page may call the backend, never a page or frame that got loaded some other way
    if (!fromApp(event.senderFrame?.url ?? '')) return { ok: false, error: 'This page may not call Frontier.' };
    const handler = (handlers as Record<string, (input: unknown) => unknown>)[name];
    if (!handler) return { ok: false, error: `Unknown method ${name}` };
    try {
      return { ok: true, value: await handler(input) };
    } catch (error) {
      if (!isCancelled(error)) ctx.log.error(`call ${name}`, error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

export type EventSink = <E extends EventName>(event: E, payload: ApiEvents[E]) => void;

export function eventSink(getWindow: () => Electron.BrowserWindow | null): EventSink {
  return (event, payload) => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send(EVENT_CHANNEL, event, payload);
  };
}

export type { ApiMethods };
