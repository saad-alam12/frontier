import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { EVENT_CHANNEL, IPC_CHANNEL } from './contract';
import type { ApiInput, ApiName, ApiOutput, EventName, FrontierBridge } from './contract';

const bridge: FrontierBridge = {
  async invoke<N extends ApiName>(name: N, input: ApiInput<N>): Promise<ApiOutput<N>> {
    const result = (await ipcRenderer.invoke(IPC_CHANNEL, name, input)) as { ok: true; value: ApiOutput<N> } | { ok: false; error: string };
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
  on(event: EventName, handler: (payload: never) => void) {
    const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => {
      if (args[0] === event) handler(args[1] as never);
    };
    ipcRenderer.on(EVENT_CHANNEL, listener);
    return () => ipcRenderer.removeListener(EVENT_CHANNEL, listener);
  },
  pathForFile(file: File) {
    return webUtils.getPathForFile(file);
  },
};

contextBridge.exposeInMainWorld('frontier', bridge);
