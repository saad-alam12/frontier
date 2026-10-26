import { dialog, ipcMain } from 'electron';
import type { ApiEvents, ApiInput, ApiMethods, ApiName, ApiOutput, EventName } from './contract';
import { EVENT_CHANNEL, IPC_CHANNEL } from './contract';
import type { AppContext } from '../context';
import { SettingsPatchSchema } from '../settings/schema';
import { runConnectionTest } from '../agents/connectionTest';
import { SUPPORTED_EXTENSIONS } from '../ingest/readers';
import { deltaForSource, listSourceSummaries } from '../services/library';
import { deleteSource } from '../store/sources';

type Handlers = { [N in ApiName]: (input: ApiInput<N>) => Promise<ApiOutput<N>> | ApiOutput<N> };

export function buildHandlers(ctx: AppContext): Handlers {
  return {
    'app.info': () => ({ version: ctx.version, dataFolder: ctx.settings.get().dataFolder, settingsFile: ctx.settingsFile }),
    'settings.get': () => ctx.settings.get(),
    'settings.update': (patch) => {
      const next = ctx.settings.update(SettingsPatchSchema.parse(patch));
      ctx.onSettingsChanged();
      return next;
    },
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
