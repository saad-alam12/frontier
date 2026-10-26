import { dialog, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import type { ApiEvents, ApiInput, ApiMethods, ApiName, ApiOutput, EventName } from './contract';
import { EVENT_CHANNEL, IPC_CHANNEL } from './contract';
import type { AppContext } from '../context';
import { SettingsPatchSchema } from '../settings/schema';
import { runConnectionTest } from '../agents/connectionTest';

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

export function emitEvent<E extends EventName>(window: BrowserWindow | null, event: E, payload: ApiEvents[E]): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(EVENT_CHANNEL, event, payload);
}

export type { ApiMethods };
