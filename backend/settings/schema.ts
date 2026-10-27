import { z } from 'zod';
import { ROLES, type Role } from '../llm/provider';

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

/**
 * Models offered in the role dropdowns. Effort support and defaults are from the current effort
 * documentation (platform.claude.com/docs/en/build-with-claude/effort): all four take every level.
 */
export const KNOWN_MODELS: { id: string; name: string; efforts: readonly Effort[]; defaultEffort: Effort }[] = [
  { id: 'claude-fable-5-1', name: 'Fable 5.1', efforts: EFFORTS, defaultEffort: 'high' },
  { id: 'claude-opus-5-5', name: 'Opus 5.5', efforts: EFFORTS, defaultEffort: 'medium' },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', efforts: EFFORTS, defaultEffort: 'high' },
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5', efforts: EFFORTS, defaultEffort: 'medium' },
];

export interface ModelChoice {
  model: string;
  effort: Effort;
}

/** The owner's defaults (feedback round 1, §7.3): Opus at xhigh only for rare, high-stakes calls. */
export const DEFAULT_CHOICES: Record<Role, ModelChoice> = {
  goalCompiler: { model: 'claude-opus-5-5', effort: 'xhigh' },
  tutor: { model: 'claude-opus-5-5', effort: 'medium' },
  tutorEscalation: { model: 'claude-opus-5-5', effort: 'xhigh' },
  prober: { model: 'claude-opus-5-5', effort: 'medium' },
  problemGenerator: { model: 'claude-sonnet-5-5', effort: 'high' },
  grader: { model: 'claude-sonnet-5-5', effort: 'high' },
  extractor: { model: 'claude-haiku-5-5', effort: 'max' },
  matcher: { model: 'claude-haiku-5-5', effort: 'max' },
  planner: { model: 'claude-haiku-5-5', effort: 'max' },
  librarian: { model: 'claude-haiku-5-5', effort: 'medium' },
  connectionTest: { model: 'claude-haiku-5-5', effort: 'medium' },
};

export const SettingsSchema = z.object({
  provider: z.enum(['agentSdk', 'anthropicApi']).default('agentSdk'),
  apiKey: z.string().default(''),
  /** Per-role model overrides; absent or empty means the default. */
  models: z.partialRecord(z.enum(ROLES), z.string()).default({}),
  /** Per-role effort overrides; absent means the default. */
  efforts: z.partialRecord(z.enum(ROLES), z.enum(EFFORTS)).default({}),
  /** Absolute path of the data folder (database, sources, exports). Empty means the default. */
  dataFolder: z.string().default(''),
  concurrency: z.number().int().min(1).max(8).default(3),
});

export type Settings = z.infer<typeof SettingsSchema>;

/** A patch; `null` for a role's effort goes back to the default. */
export const SettingsPatchSchema = SettingsSchema.partial().extend({
  efforts: z.partialRecord(z.enum(ROLES), z.enum(EFFORTS).nullable()).optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

/** Efforts a model accepts; a custom model is offered every level. */
export function effortsFor(model: string): readonly Effort[] {
  return KNOWN_MODELS.find((m) => m.id === model)?.efforts ?? EFFORTS;
}

/** What the Settings screen needs to offer models and efforts per role. */
export interface ModelOptions {
  models: { id: string; name: string; efforts: Effort[] }[];
  efforts: Effort[];
  defaults: Record<Role, ModelChoice>;
}

export function modelOptions(): ModelOptions {
  return { models: KNOWN_MODELS.map((m) => ({ id: m.id, name: m.name, efforts: [...m.efforts] })), efforts: [...EFFORTS], defaults: DEFAULT_CHOICES };
}

export function modelChoice(settings: Settings, role: Role): ModelChoice {
  const fallback = DEFAULT_CHOICES[role];
  const model = settings.models[role]?.trim() || fallback.model;
  const wanted = settings.efforts[role] ?? (model === fallback.model ? fallback.effort : (KNOWN_MODELS.find((m) => m.id === model)?.defaultEffort ?? 'high'));
  const allowed = effortsFor(model);
  return { model, effort: allowed.includes(wanted) ? wanted : (allowed[allowed.length - 1] ?? 'high') };
}
