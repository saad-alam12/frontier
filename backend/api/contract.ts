/**
 * The IPC contract between the renderer and the backend. The UI imports only types from here.
 * Each method has an input and an output type; handlers live in ./handlers.ts.
 */
import type { Settings, SettingsPatch } from '../settings/schema';
import type { ConnectionTestResult } from '../agents/connectionTest';
import type { DeltaSummary, SourceSummary } from '../services/library';
import type { IngestProgress } from '../services/ingestion';

export type { Settings, SettingsPatch, ConnectionTestResult, DeltaSummary, SourceSummary, IngestProgress };
export type { Role } from '../llm/provider';
export type { DeltaClass } from '../core/delta';

export interface AppInfo {
  version: string;
  dataFolder: string;
  settingsFile: string;
}

export interface ApiMethods {
  'app.info': { input: undefined; output: AppInfo };
  'settings.get': { input: undefined; output: Settings };
  'settings.update': { input: SettingsPatch; output: Settings };
  'settings.testConnection': { input: undefined; output: ConnectionTestResult };
  'settings.chooseFolder': { input: undefined; output: string | null };
  'library.list': { input: undefined; output: SourceSummary[] };
  /** Opens a file picker, adds the chosen files and starts ingesting them. */
  'library.addFiles': { input: undefined; output: { added: SourceSummary[]; skipped: string[] } };
  'library.run': { input: { sourceId: string }; output: undefined };
  'library.remove': { input: { sourceId: string }; output: undefined };
  'library.delta': { input: { sourceId: string }; output: DeltaSummary };
}

export type ApiName = keyof ApiMethods;
export type ApiInput<N extends ApiName> = ApiMethods[N]['input'];
export type ApiOutput<N extends ApiName> = ApiMethods[N]['output'];

/** Events pushed from the backend to the renderer. */
export interface ApiEvents {
  'app.toast': { kind: 'info' | 'error'; message: string };
  'library.progress': IngestProgress;
}
export type EventName = keyof ApiEvents;

export const IPC_CHANNEL = 'frontier:invoke';
export const EVENT_CHANNEL = 'frontier:event';

export interface FrontierBridge {
  invoke<N extends ApiName>(name: N, input: ApiInput<N>): Promise<ApiOutput<N>>;
  on<E extends EventName>(event: E, handler: (payload: ApiEvents[E]) => void): () => void;
}
