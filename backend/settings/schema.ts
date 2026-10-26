import { z } from 'zod';
import { ROLES, type Role } from '../llm/provider';

export const STRONG_MODEL = 'claude-opus-5-5';
export const CHEAP_MODEL = 'claude-sonnet-5-5';

export const DEFAULT_MODELS: Record<Role, string> = {
  goalCompiler: STRONG_MODEL,
  prober: STRONG_MODEL,
  planner: STRONG_MODEL,
  tutor: STRONG_MODEL,
  extractor: CHEAP_MODEL,
  matcher: CHEAP_MODEL,
  problemGenerator: STRONG_MODEL,
  grader: STRONG_MODEL,
  librarian: CHEAP_MODEL,
  connectionTest: CHEAP_MODEL,
};

export const SettingsSchema = z.object({
  provider: z.enum(['agentSdk', 'anthropicApi']).default('agentSdk'),
  apiKey: z.string().default(''),
  models: z.partialRecord(z.enum(ROLES), z.string()).default({}),
  /** Absolute path of the data folder (database, sources, exports). Empty means the default. */
  dataFolder: z.string().default(''),
  concurrency: z.number().int().min(1).max(8).default(3),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsPatchSchema = SettingsSchema.partial();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export function modelForRole(settings: Settings, role: Role): string {
  return settings.models[role] ?? DEFAULT_MODELS[role];
}
