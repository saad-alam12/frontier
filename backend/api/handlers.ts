import { dialog, ipcMain } from 'electron';
import type { ApiEvents, ApiInput, ApiMethods, ApiName, ApiOutput, EventName, MaterialCandidate } from './contract';
import { EVENT_CHANNEL, IPC_CHANNEL } from './contract';
import type { AppContext } from '../context';
import { SettingsPatchSchema, modelOptions } from '../settings/schema';
import { runConnectionTest } from '../agents/connectionTest';
import { SUPPORTED_EXTENSIONS } from '../ingest/readers';
import { deltaForSource, listSourceSummaries } from '../services/library';
import { approveGoalPlan, createGoalFromForm, goalDetail, guessRole, updateGoalFromForm } from '../services/goals';
import { previewPlan } from '../services/budget';
import { tick } from '../services/activity';
import { statsView } from '../services/stats';
import { createProbe, openProbe, submitProbe } from '../services/probe';
import { planSession } from '../services/planner';
import { abandonSession, currentSession, pauseSession, respond, startSession } from '../services/session';
import { refreshGoalFields } from '../services/knowledge';
import { currentPractice, practiceView, startPractice, submitPracticeAnswer } from '../services/practice';
import { todayView } from '../services/today';
import { mapView, nodeCard } from '../services/map';
import { lookup, openCard } from '../services/lookup';
import { listTrails, trail } from '../services/trails';
import { deleteGoal, listGoals, startUnverified } from '../store/goals';
import { deleteSource } from '../store/sources';
import { getDrafts, setDraft } from '../store/drafts';

type Handlers = { [N in ApiName]: (input: ApiInput<N>) => Promise<ApiOutput<N>> | ApiOutput<N> };

export function buildHandlers(ctx: AppContext): Handlers {
  const detail = (goalId: string) => {
    const d = goalDetail(ctx.db(), goalId, ctx.goalWorker().status(goalId));
    if (!d) throw new Error('unknown goal');
    return d;
  };
  /** Add files to the library unread and guess what each is for; reading starts once a goal uses them. */
  const addMaterials = async (paths: string[]): Promise<MaterialCandidate[]> => {
    const out: MaterialCandidate[] = [];
    for (const path of paths) {
      const { source, existed } = await ctx.ingestion().addFile(path);
      const guess = await guessRole(ctx.db(), ctx.provider(), source.id).catch(() => ({ role: 'teaching' as const, reason: 'Could not tell; assumed teaching material.' }));
      out.push({ sourceId: source.id, title: source.title, role: guess.role, reason: guess.reason, existed });
    }
    return out;
  };
  return {
    'app.info': () => ({ version: ctx.version, dataFolder: ctx.settings.get().dataFolder, settingsFile: ctx.settingsFile }),
    'settings.get': () => ctx.settings.get(),
    'settings.update': (patch) => {
      const next = ctx.settings.update(SettingsPatchSchema.parse(patch));
      ctx.onSettingsChanged();
      return next;
    },
    'settings.modelOptions': () => modelOptions(),
    'settings.testConnection': () => runConnectionTest(ctx.provider()),
    'settings.chooseFolder': async () => {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    'library.list': () => listSourceSummaries(ctx.db()),
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
    'library.remove': ({ sourceId }) => {
      deleteSource(ctx.db(), sourceId);
      return undefined;
    },
    'library.delta': ({ sourceId }) => deltaForSource(ctx.db(), sourceId),
    'goals.list': () => listGoals(ctx.db()).map((g) => detail(g.id)),
    'goals.get': ({ goalId }) => detail(goalId),
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
    'goals.preview': ({ goalId, budget }) => previewPlan(ctx.db(), goalId, budget),
    'goals.approve': ({ goalId }) => {
      approveGoalPlan(ctx.db(), goalId);
      return detail(goalId);
    },
    'goals.remove': ({ goalId }) => {
      deleteGoal(ctx.db(), goalId);
      refreshGoalFields(ctx.db());
      return undefined;
    },
    'goals.compile': async ({ goalId }) => {
      await ctx.goalWorker().compileNow(goalId);
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
    'probe.submit': ({ probeId, answers }) => submitProbe(ctx.db(), ctx.provider(), probeId, answers),
    'plan.preview': ({ goalId }) => planSession(ctx.db(), ctx.provider(), goalId),
    'session.current': () => currentSession(ctx.db()),
    'session.start': ({ goalId }) => startSession(ctx.practiceDeps(), goalId),
    'session.respond': ({ sessionId, response }) => respond(ctx.practiceDeps(), sessionId, response),
    'session.pause': ({ sessionId }) => {
      pauseSession(ctx.db(), sessionId);
      return undefined;
    },
    'session.end': async ({ sessionId }) => {
      await abandonSession(ctx.practiceDeps(), sessionId);
      return undefined;
    },
    'today.view': () => todayView(ctx.db()),
    'practice.current': () => currentPractice(ctx.db()),
    'practice.get': ({ setId }) => practiceView(ctx.db(), setId),
    'practice.start': ({ goalId, kind }) => startPractice(ctx.practiceDeps(), goalId, { kind }),
    'practice.submit': ({ problemId, answer, confidence }) => submitPracticeAnswer(ctx.practiceDeps(), problemId, answer, confidence),
    'map.view': () => mapView(ctx.db()),
    'map.card': ({ nodeId }) => nodeCard(ctx.db(), nodeId),
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
  };
}

/** Transport only: route every invoke to its handler and wrap errors as plain data. */
export function registerIpc(ctx: AppContext): void {
  const handlers = buildHandlers(ctx);
  ipcMain.handle(IPC_CHANNEL, async (_event, name: string, input: unknown) => {
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
