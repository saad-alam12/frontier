import { writeFile } from 'node:fs/promises';
import { app, dialog, ipcMain, net, shell } from 'electron';
import { join } from 'node:path';
import { cheatSheetView, exportGoalNotes, goalNotesView, noteFor, saveNote } from '../services/notes';
import { notesPdfName } from '../core/notes';
import { editIdea, mergeCandidates, mergeIdeas } from '../services/mapEdit';
import { weekReview } from '../services/weekReview';
import { watchedFolderViews } from '../services/folderWatch';
import { misconceptionsView } from '../services/misconceptions';
import { dismissMisconception } from '../services/bugs';
import type { ApiEvents, ApiInput, ApiMethods, ApiName, ApiOutput, EventName, MakerView, SettingsView } from './contract';
import { EVENT_CHANNEL, IPC_CHANNEL } from './contract';
import { checkInput } from './inputs';
import type { AppContext } from '../context';
import { modelOptions } from '../settings/schema';
import type { Settings } from '../settings/schema';
import { runConnectionTest } from '../agents/connectionTest';
import { isCancelled } from '../llm/provider';
import { SUPPORTED_EXTENSIONS } from '../ingest/readers';
import { addGoalMaterials, addLibraryFiles, addLink, addPastedText, deltaForSource, listSourceSummaries, readSourceAgain, storedCopyPath } from '../services/library';
import { approveGoalPlan, askForRemap, createGoalFromForm, goDeeper, goalDetail, listGoalDetails, removeGoal, setGoalStatus, startUngrounded, updateGoalFromForm, useFreedTime } from '../services/goals';
import { previewPlan } from '../services/budget';
import { tick } from '../services/activity';
import { statsView } from '../services/stats';
import { cancelProbe, createProbe, openProbe, probeGoalId, submitProbe } from '../services/probe';
import { planSession } from '../services/planner';
import { abandonSession, currentSession, pauseSession, respond, startSession, askTutor } from '../services/session';
import { previewFree, startFreeSession } from '../services/freeSession';
import { openPythonInstaller } from '../services/codeRunner';
import { sourceDocument } from '../services/sourceView';
import { currentPractice, endPracticeSet, handInExam, practiceView, resumeGrading, startPractice, submitPracticeAnswer } from '../services/practice';
import { todayView } from '../services/today';
import { mapView, nodeCard } from '../services/map';
import { eraseFromMap, previewErase, removeSource } from '../services/erase';
import { lookup, openCard } from '../services/lookup';
import { listTrails, trail } from '../services/trails';
import { approveRemap, dismissRemap, remapView } from '../services/remap';
import { additionView, applyAddition, dismissAddition, requestAddition } from '../services/addition';
import { draftsFor, keepDraft } from '../services/drafts';
import { keepPicture, pictureForWindow } from '../services/attachments';
import { figureView } from '../services/figures';
import { usageView } from '../services/usage';
import { answerDialogue, dialogueView, endDialogue, openDialogueView, startDialogue } from '../services/dialogue';
import { cardPreferences, cardQueue, cardStats, cardSummary, draftFor, findIdeas, goalCardSettings, listCardViews, removeCard, reviewCard, saveCard, saveCardPreferences, saveGoalCards, suspendCard, undoReview } from '../services/cards';

type Handlers = { [N in ApiName]: (input: ApiInput<N>) => Promise<ApiOutput<N>> | ApiOutput<N> };

export function buildHandlers(ctx: AppContext): Handlers {
  /** Screens that count or list cards (the sidebar, Today, a goal page) refresh on this. */
  /** The window never gets the API key back: only whether one is kept. */
  const forWindow = (settings: Settings): SettingsView => ({ ...settings, apiKey: '', apiKeySaved: Boolean(settings.apiKey), apiKeyLost: ctx.settings.keyLost && !settings.apiKey, keychain: ctx.settings.sealsKeys() });
  const cardsChanged = (goalId: string | null) => ctx.emit('cards.changed', { goalId });
  const detail = (goalId: string) => {
    const d = goalDetail(ctx.db(), goalId, ctx.goalWorker().status(goalId));
    if (!d) throw new Error('unknown goal');
    return d;
  };
  /** Files offered as a goal's material; one that cannot be read is named in a message, not lost. */
  const addMaterials = async (paths: string[]) => {
    const { candidates, failed } = await addGoalMaterials({ db: ctx.db(), ingestion: ctx.ingestion(), provider: ctx.provider() }, paths);
    if (failed.length) ctx.emit('app.toast', { kind: 'error', message: failed.join(' ') });
    return candidates;
  };
  const dialogueDeps = () => ({ db: ctx.db(), provider: ctx.provider(), onWriting: (dialogueId: string, text: string) => ctx.emit('dialogue.writing', { dialogueId, text }) });
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
      ctx.restoreBackup(file);
      return null;
    },
    'backups.showFolder': async () => {
      await shell.openPath(ctx.paths().backups);
      return null;
    },
    'settings.get': () => forWindow(ctx.settings.get()),
    'settings.update': (patch) => {
      const previous = ctx.settings.get();
      const next = ctx.settings.update(patch);
      ctx.onSettingsChanged(previous);
      return forWindow(next);
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
    'library.addLink': ({ url }) => addLink({ ingestion: ctx.ingestion(), fetcher: (address, init) => net.fetch(address, init), userAgent: `Frontier/${ctx.version}` }, url),
    'library.addFiles': async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Sources', extensions: SUPPORTED_EXTENSIONS }],
      });
      return addLibraryFiles({ db: ctx.db(), ingestion: ctx.ingestion() }, result.canceled ? [] : result.filePaths);
    },
    'library.addPaths': async ({ paths }) => {
      const result = await addLibraryFiles({ db: ctx.db(), ingestion: ctx.ingestion() }, paths);
      // dropped anywhere on the window: the Library may not be the screen that is open
      if (result.skipped.length) ctx.emit('app.toast', { kind: 'error', message: result.skipped.join(' ') });
      return result;
    },
    'library.stop': ({ sourceId }) => {
      ctx.ingestion().stop(sourceId);
      return undefined;
    },
    'library.openOriginal': async ({ sourceId }) => {
      // shell.openPath answers with a message when it fails, and with nothing when the file opened
      const problem = await shell.openPath(storedCopyPath(ctx.db(), ctx.paths().sources, sourceId));
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
    'library.document': ({ sourceId }) => sourceDocument(ctx.db(), ctx.paths().sources, sourceId),
    'library.watchedFolders': () => watchedFolderViews(ctx.db()),
    'library.watchFolder': async ({ goalId }) => {
      const window = ctx.window();
      const options: Electron.OpenDialogOptions = { title: 'Choose a folder to watch', properties: ['openDirectory'] };
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      const path = result.filePaths[0];
      if (result.canceled || !path) return null;
      const added = await ctx.folderWatcher().add(path, goalId);
      return { added, folders: await watchedFolderViews(ctx.db()) };
    },
    'library.unwatchFolder': async ({ path }) => {
      ctx.folderWatcher().remove(path);
      return watchedFolderViews(ctx.db());
    },
    'library.scanFolders': async () => {
      const added = await ctx.folderWatcher().scanAll();
      return { added, folders: await watchedFolderViews(ctx.db()) };
    },
    'goals.list': () => listGoalDetails(ctx.db(), (goalId) => ctx.goalWorker().status(goalId)),
    'goals.get': ({ goalId }) => detail(goalId),
    'goals.exportNotes': async ({ goalId }) => {
      const { fileName, markdown } = exportGoalNotes(ctx.db(), goalId);
      const result = await dialog.showSaveDialog({ defaultPath: join(app.getPath('documents'), fileName), filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (result.canceled || !result.filePath) return { path: null };
      await writeFile(result.filePath, markdown, 'utf8');
      return { path: result.filePath };
    },
    'notes.goal': ({ goalId }) => goalNotesView(ctx.db(), goalId),
    'notes.sheet': ({ goalId, all }) => cheatSheetView(ctx.db(), goalId, { all: all ?? false }),
    'notes.idea': ({ nodeId }) => ({ note: noteFor(ctx.db(), nodeId) }),
    'notes.saveIdea': ({ nodeId, text }) => saveNote(ctx.db(), nodeId, text),
    'notes.print': async () => {
      const window = ctx.window();
      if (!window) return { printed: false };
      const printed = await new Promise<boolean>((resolve) => window.webContents.print({}, (success) => resolve(success)));
      return { printed };
    },
    'notes.savePdf': async ({ goalId, kind }) => {
      const window = ctx.window();
      if (!window) return { path: null };
      const title = goalNotesView(ctx.db(), goalId).title;
      const base = notesPdfName(title, kind);
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
      setGoalStatus(ctx.db(), goalId, status);
      ctx.emit('goals.changed', { goalId });
      return detail(goalId);
    },
    'goals.preview': ({ goalId, budget }) => previewPlan(ctx.db(), goalId, budget),
    'goals.approve': ({ goalId }) => {
      approveGoalPlan(ctx.db(), goalId);
      return detail(goalId);
    },
    'goals.remove': ({ goalId }) => {
      removeGoal(ctx.db(), goalId);
      return undefined;
    },
    'goals.goDeeper': ({ goalId, nodeIds }) => goDeeper(ctx.db(), goalId, nodeIds),
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
      askForRemap(ctx.db(), goalId);
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
      startUngrounded(ctx.db(), goalId, nodeId);
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
      const goalId = probeGoalId(ctx.db(), probeId);
      if (goalId) ctx.goalWorker().refresh(goalId); // missing background may call for a new map
      return outcomes;
    },
    'probe.cancel': ({ probeId }) => cancelProbe(probeId),
    'plan.preview': ({ goalId }) => planSession(ctx.db(), ctx.provider(), goalId),
    'session.current': () => currentSession(ctx.db(), ctx.sessionWork),
    'session.work': () => ctx.sessionWork.current(),
    'session.start': ({ goalId, focus, minutes }) => startSession(ctx.practiceDeps(), goalId, focus, minutes),
    'session.respond': async ({ sessionId, response, draftKey }) => {
      const snap = await respond(ctx.practiceDeps(), sessionId, response, { draftKey });
      if (snap.status !== 'active' && snap.goalId) ctx.goalWorker().refresh(snap.goalId); // a finished session may call for a new map
      return snap;
    },
    'session.ask': ({ sessionId, mode, question }) => askTutor(ctx.practiceDeps(), sessionId, { mode, question }),
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
      const { goalId } = await abandonSession(ctx.practiceDeps(), sessionId);
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
        maxProblems: problems,
        focus: nodeIds?.length ? { nodeIds, level } : undefined,
      }),
    'practice.handIn': ({ setId }) => handInExam(ctx.db(), setId),
    'dialogue.start': ({ goalId, kind }) => startDialogue(dialogueDeps(), goalId, kind),
    'dialogue.get': ({ dialogueId }) => dialogueView(ctx.db(), dialogueId),
    'dialogue.open': ({ goalId }) => openDialogueView(ctx.db(), goalId),
    'dialogue.answer': ({ dialogueId, answer }) => answerDialogue(dialogueDeps(), dialogueId, answer),
    'dialogue.end': ({ dialogueId }) => endDialogue(dialogueDeps(), dialogueId),
    'practice.submit': ({ problemId, answer, confidence, code, attachments, quote }) => submitPracticeAnswer(ctx.practiceDeps(), problemId, answer, confidence, { code, attachments, quote }),
    'code.run': ({ source, key }) => ctx.codeRunner().run(source, key),
    'code.stop': ({ key }) => ({ stopped: ctx.codeRunner().stop(key) }),
    'code.install': ({ package: pkg, key }) => ctx.codeRunner().install(pkg, key),
    'code.python': async ({ lookAgain }) => {
      if (lookAgain) ctx.codeRunner().lookAgain();
      return ctx.codeRunner().info();
    },
    'code.installPython': () => openPythonInstaller(),
    'map.view': () => mapView(ctx.db()),
    'map.card': ({ nodeId }) => nodeCard(ctx.db(), nodeId),
    'map.erasePreview': (request) => previewErase(ctx.db(), request),
    'map.erase': (request) => {
      const result = eraseFromMap({ db: ctx.db(), sourcesDir: ctx.paths().sources, figuresDir: ctx.paths().figures, isReading: (id) => ctx.ingestion().isRunning(id) }, request);
      for (const goalId of result.goalsToMap) ctx.goalWorker().refresh(goalId); // goals left with no map are mapped again
      return result;
    },
    'map.editIdea': ({ nodeId, name, statement }) => {
      const result = editIdea(ctx.db(), nodeId, { name, statement });
      // matching and Lookup read the idea by meaning: its embedding follows the new text
      if (result.changed) void ctx.ingestion().ensureEmbeddings().catch(() => undefined);
      return result;
    },
    'map.mergeCandidates': ({ nodeId, query }) => mergeCandidates(ctx.db(), nodeId, query),
    'map.mergeIdeas': ({ keepId, dropId }) => mergeIdeas(ctx.db(), keepId, dropId),
    'lookup.search': ({ query, history, passage }) =>
      lookup({ db: ctx.db(), provider: ctx.provider(), embedder: ctx.embedder(), ingestion: ctx.ingestion() }, query, history, passage),
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
      dismissMisconception(ctx.db(), bugId);
      return misconceptionsView(ctx.db());
    },
    'stats.week': ({ weekOf }) => weekReview(ctx.db(), weekOf),
    'drafts.get': ({ keys }) => draftsFor(ctx.db(), keys),
    'drafts.set': ({ key, value }) => {
      keepDraft(ctx.db(), key, value);
      return undefined;
    },
    'attachments.save': (upload) => keepPicture(ctx.paths().attachments, upload),
    'attachments.read': ({ name }) => pictureForWindow(ctx.paths().attachments, name),
    'settings.usage': () => usageView(ctx.db()),
    'figures.read': (input) => figureView(ctx.db(), ctx.paths().figures, input.figureId),
    'cards.queue': ({ goalId }) => cardQueue(ctx.db(), goalId),
    'cards.review': ({ cardId, rating, goalId }) => {
      reviewCard(ctx.db(), cardId, rating);
      cardsChanged(null);
      return cardQueue(ctx.db(), goalId);
    },
    'cards.undoReview': ({ cardId, goalId }) => {
      undoReview(ctx.db(), cardId);
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
    'cards.savePreferences': (prefs) => saveCardPreferences(ctx.db(), prefs),
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
    const checked = checkInput(name as ApiName, input);
    if (!checked.ok) {
      ctx.log.info(`call ${name}`, `input refused at ${checked.field || 'the top'}: ${checked.message}`);
      return { ok: false, error: checked.message };
    }
    try {
      return { ok: true, value: await handler(checked.data) };
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
