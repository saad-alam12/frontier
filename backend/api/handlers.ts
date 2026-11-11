import { activeSession } from '../store/sessions';
import { z } from 'zod';
import { writeFile } from 'node:fs/promises';
import { app, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { exportGoalNotes } from '../services/notes';
import type { ApiEvents, ApiInput, ApiMethods, ApiName, ApiOutput, EventName, MakerView, MaterialCandidate } from './contract';
import { EVENT_CHANNEL, IPC_CHANNEL } from './contract';
import type { AppContext } from '../context';
import { SettingsPatchSchema, modelOptions } from '../settings/schema';
import { runConnectionTest } from '../agents/connectionTest';
import { SUPPORTED_EXTENSIONS } from '../ingest/readers';
import { addPastedText, deltaForSource, listSourceSummaries, readSourceAgain } from '../services/library';
import { approveGoalPlan, createGoalFromForm, goDeeper, goalDetail, guessRole, setGoalStatus, updateGoalFromForm } from '../services/goals';
import { previewPlan } from '../services/budget';
import { tick } from '../services/activity';
import { statsView } from '../services/stats';
import { cancelProbe, createProbe, openProbe, submitProbe } from '../services/probe';
import { planSession } from '../services/planner';
import { abandonSession, currentSession, pauseSession, respond, startSession } from '../services/session';
import { previewFree, startFreeSession } from '../services/freeSession';
import { refreshGoalFields } from '../services/knowledge';
import { currentPractice, practiceView, startPractice, submitPracticeAnswer, endPracticeSet, resumeGrading } from '../services/practice';
import { todayView } from '../services/today';
import { mapView, nodeCard } from '../services/map';
import { EraseRequestSchema, eraseFromMap, previewErase, removeSource } from '../services/erase';
import { lookup, openCard } from '../services/lookup';
import { listTrails, trail } from '../services/trails';
import { deleteGoal, listGoals, requestRemap, startUnverified } from '../store/goals';
import { getProbeSet } from '../store/probes';
import { getSession } from '../store/sessions';
import { approveRemap, dismissRemap, remapView } from '../services/remap';
import { additionView, applyAddition, dismissAddition, requestAddition } from '../services/addition';
import { getDrafts, setDraft } from '../store/drafts';
import { attachmentDataUrl, saveAttachment } from '../store/attachments';
import {
  ReviewInputSchema,
  cardPreferences,
  cardQueue,
  cardStats,
  cardSummary,
  draftFor,
  findIdeas,
  goalCardSettings,
  listCardViews,
  removeCard,
  reviewCard,
  saveCard,
  saveCardPreferences,
  saveGoalCards,
  suspendCard,
} from '../services/cards';

type Handlers = { [N in ApiName]: (input: ApiInput<N>) => Promise<ApiOutput<N>> | ApiOutput<N> };

export function buildHandlers(ctx: AppContext): Handlers {
  /** Screens that count or list cards (the sidebar, Today, a goal page) refresh on this. */
  const cardsChanged = (goalId: string | null) => ctx.emit('cards.changed', { goalId });
  const detail = (goalId: string) => {
    const d = goalDetail(ctx.db(), goalId, ctx.goalWorker().status(goalId));
    if (!d) throw new Error('unknown goal');
    return d;
  };
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
  return {
    'app.info': () => ({ version: ctx.version, dataFolder: ctx.settings.get().dataFolder, settingsFile: ctx.settingsFile }),
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
    'library.list': () => listSourceSummaries(ctx.db()),
    'library.addText': async (input) => {
      const { source, existed } = await addPastedText(ctx.ingestion(), input);
      return { sourceId: source.id, existed };
    },
    'library.addFiles': async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Sources', extensions: SUPPORTED_EXTENSIONS }],
      });
      const added: string[] = [];
      const skipped: string[] = [];
      if (!result.canceled) {
        for (const path of result.filePaths) {
          try {
            const { source, existed } = await ctx.ingestion().addFile(path);
            if (existed) skipped.push(`${path} (already in the library)`);
            else added.push(source.id);
            if (source.status !== 'done') ctx.ingestion().start(source.id);
          } catch (error) {
            skipped.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      const summaries = listSourceSummaries(ctx.db()).filter((s) => added.includes(s.id));
      return { added: summaries, skipped };
    },
    'library.run': ({ sourceId }) => {
      ctx.ingestion().start(sourceId);
      return undefined;
    },
    'library.reread': ({ sourceId }) => readSourceAgain(ctx.db(), ctx.ingestion(), sourceId),
    'library.remove': ({ sourceId }) => {
      removeSource({ db: ctx.db(), sourcesDir: ctx.paths().sources, isReading: (id) => ctx.ingestion().isRunning(id) }, sourceId);
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
    'session.start': ({ goalId, focus }) => startSession(ctx.practiceDeps(), goalId, focus),
    'session.respond': async ({ sessionId, response, draftKey }) => {
      const snap = await respond(ctx.practiceDeps(), sessionId, response, { draftKey });
      if (snap.status !== 'active' && snap.goalId) ctx.goalWorker().refresh(snap.goalId); // a finished session may call for a new map
      return snap;
    },
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
    'practice.start': ({ goalId, kind }) => startPractice(ctx.practiceDeps(), goalId, { kind }),
    'practice.submit': ({ problemId, answer, confidence }) => submitPracticeAnswer(ctx.practiceDeps(), problemId, answer, confidence),
    'map.view': () => mapView(ctx.db()),
    'map.card': ({ nodeId }) => nodeCard(ctx.db(), nodeId),
    'map.erasePreview': (request) => previewErase(ctx.db(), EraseRequestSchema.parse(request)),
    'map.erase': (request) => {
      const result = eraseFromMap({ db: ctx.db(), sourcesDir: ctx.paths().sources, isReading: (id) => ctx.ingestion().isRunning(id) }, EraseRequestSchema.parse(request));
      for (const goalId of result.goalsToMap) ctx.goalWorker().refresh(goalId); // goals left with no map are mapped again
      return result;
    },
    'lookup.search': ({ query }) => lookup({ db: ctx.db(), provider: ctx.provider(), embedder: ctx.embedder(), ingestion: ctx.ingestion() }, query),
    'lookup.open': ({ nodeId }) => openCard(ctx.db(), nodeId),
    'trails.list': ({ nodeId }) => listTrails(ctx.db(), nodeId),
    'trails.get': ({ sessionId }) => trail(ctx.db(), sessionId),
    'activity.tick': (input) => {
      tick(ctx.db(), input);
      return undefined;
    },
    'stats.view': (filter) => statsView(ctx.db(), filter),
    'drafts.get': ({ keys }) => getDrafts(ctx.db(), keys),
    'drafts.set': ({ key, value }) => {
      setDraft(ctx.db(), key, value);
      return undefined;
    },
    'attachments.save': (upload) => ({ name: saveAttachment(ctx.paths().attachments, upload) }),
    'attachments.read': ({ name }) => attachmentDataUrl(ctx.paths().attachments, name),
    'cards.queue': ({ goalId }) => cardQueue(ctx.db(), goalId),
    'cards.review': (input) => {
      const { cardId, rating } = ReviewInputSchema.parse(input);
      reviewCard(ctx.db(), cardId, rating);
      cardsChanged(null);
      return cardQueue(ctx.db(), input.goalId);
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
