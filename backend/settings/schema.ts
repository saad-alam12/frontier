import { z } from 'zod';
import { DEFAULT_REMINDER_TIME, clockMinutes } from '../core/reminders';
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

/**
 * The owner's defaults (feedback round 1, §7.3): Opus at xhigh only for rare, high-stakes calls. The
 * extractor's effort was left to be confirmed; reading a whole paper at max took 340 s against 27 s at
 * medium for the same ideas (2026-11-03), so it is medium.
 */
export const DEFAULT_CHOICES: Record<Role, ModelChoice> = {
  goalCompiler: { model: 'claude-opus-5-5', effort: 'xhigh' },
  tutor: { model: 'claude-opus-5-5', effort: 'medium' },
  tutorEscalation: { model: 'claude-opus-5-5', effort: 'xhigh' },
  prober: { model: 'claude-opus-5-5', effort: 'medium' },
  problemGenerator: { model: 'claude-sonnet-5-5', effort: 'high' },
  grader: { model: 'claude-sonnet-5-5', effort: 'high' },
  extractor: { model: 'claude-haiku-5-5', effort: 'medium' },
  matcher: { model: 'claude-haiku-5-5', effort: 'max' },
  // the learner waits on the plan when they press Start session; max was many times slower for the same pick
  planner: { model: 'claude-haiku-5-5', effort: 'medium' },
  librarian: { model: 'claude-haiku-5-5', effort: 'medium' },
  // The learner waits on both: a session they described, a flashcard drafted from a selection.
  sessionPlanner: { model: 'claude-opus-5-5', effort: 'medium' },
  cardWriter: { model: 'claude-sonnet-5-5', effort: 'medium' },
  connectionTest: { model: 'claude-haiku-5-5', effort: 'medium' },
};

/** Three ways to spend the plan (design §10, Settings): the model and effort per job, before any job set by hand. */
export const PRESETS = ['best', 'balanced', 'light'] as const;
export type Preset = (typeof PRESETS)[number];

const opus = (effort: Effort): ModelChoice => ({ model: 'claude-opus-5-5', effort });
const sonnet = (effort: Effort): ModelChoice => ({ model: 'claude-sonnet-5-5', effort });
const haiku = (effort: Effort): ModelChoice => ({ model: 'claude-haiku-5-5', effort });

export const PRESET_CHOICES: Record<Preset, Record<Role, ModelChoice>> = {
  // stronger models and more thinking where quality shows: teaching, grading, problems, reading
  best: {
    goalCompiler: opus('xhigh'),
    tutor: opus('high'),
    tutorEscalation: opus('max'),
    prober: opus('high'),
    problemGenerator: opus('high'),
    grader: opus('medium'),
    extractor: sonnet('medium'),
    matcher: haiku('max'),
    planner: haiku('high'),
    librarian: sonnet('medium'),
    sessionPlanner: opus('high'),
    cardWriter: sonnet('high'),
    connectionTest: haiku('medium'),
  },
  balanced: DEFAULT_CHOICES,
  // smaller models and less thinking: teaching and grading stay good enough, the plan lasts longer
  light: {
    goalCompiler: opus('medium'),
    tutor: sonnet('medium'),
    tutorEscalation: opus('medium'),
    prober: sonnet('medium'),
    problemGenerator: sonnet('medium'),
    grader: haiku('high'),
    extractor: haiku('low'),
    matcher: haiku('high'),
    planner: haiku('low'),
    librarian: haiku('low'),
    sessionPlanner: sonnet('medium'),
    cardWriter: haiku('medium'),
    connectionTest: haiku('low'),
  },
};

/** One definition per field; `SettingsSchema` adds the defaults, a patch has none. */
const FIELDS = {
  provider: z.enum(['agentSdk', 'anthropicApi']),
  apiKey: z.string(),
  /** The model and effort per job, unless a job is set by hand below. */
  preset: z.enum(PRESETS),
  /** Per-role model overrides; absent or empty means the preset's. */
  models: z.partialRecord(z.enum(ROLES), z.string()),
  /** Per-role effort overrides; absent means the default. */
  efforts: z.partialRecord(z.enum(ROLES), z.enum(EFFORTS)),
  /** Absolute path of the data folder (database, sources, exports). Empty means the default. */
  dataFolder: z.string(),
  concurrency: z.number().int().min(1).max(8),
  /** One notification a day when something is due and nothing was studied yet. */
  reminderDaily: z.boolean(),
  /** The time of day for it, "HH:MM". */
  reminderTime: z.string().refine((time) => clockMinutes(time) !== null, 'A time of day, like 18:00.'),
  /** Flashcards to review as a number on the app's icon. */
  iconBadge: z.boolean(),
  /** The Python that runs the learner's code; empty means Frontier finds one (design §4.4, "Code"). */
  pythonPath: z.string().max(1000),
};

export const SettingsSchema = z.object({
  provider: FIELDS.provider.default('agentSdk'),
  apiKey: FIELDS.apiKey.default(''),
  preset: FIELDS.preset.default('balanced'),
  models: FIELDS.models.default({}),
  efforts: FIELDS.efforts.default({}),
  dataFolder: FIELDS.dataFolder.default(''),
  concurrency: FIELDS.concurrency.default(3),
  reminderDaily: FIELDS.reminderDaily.default(true),
  reminderTime: FIELDS.reminderTime.default(DEFAULT_REMINDER_TIME),
  iconBadge: FIELDS.iconBadge.default(true),
  pythonPath: FIELDS.pythonPath.default(''),
});

export type Settings = z.infer<typeof SettingsSchema>;

/**
 * A patch holds only the fields that change; `null` for a role's effort goes back to the default. It
 * is built without the defaults on purpose: a patch that filled in defaults would reset every field
 * it does not name (the provider, the key and the data folder with any other change).
 */
export const SettingsPatchSchema = z.strictObject({
  provider: FIELDS.provider.optional(),
  apiKey: FIELDS.apiKey.optional(),
  preset: FIELDS.preset.optional(),
  models: FIELDS.models.optional(),
  efforts: z.partialRecord(z.enum(ROLES), z.enum(EFFORTS).nullable()).optional(),
  dataFolder: FIELDS.dataFolder.optional(),
  concurrency: FIELDS.concurrency.optional(),
  reminderDaily: FIELDS.reminderDaily.optional(),
  reminderTime: FIELDS.reminderTime.optional(),
  iconBadge: FIELDS.iconBadge.optional(),
  pythonPath: FIELDS.pythonPath.optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

/** Efforts a model accepts; a custom model is offered every level. */
export function effortsFor(model: string): readonly Effort[] {
  return KNOWN_MODELS.find((m) => m.id === model)?.efforts ?? EFFORTS;
}

/** What the Settings screen needs to offer presets, and models and efforts per role. */
export interface ModelOptions {
  models: { id: string; name: string; efforts: Effort[] }[];
  efforts: Effort[];
  presets: Record<Preset, Record<Role, ModelChoice>>;
}

export function modelOptions(): ModelOptions {
  return { models: KNOWN_MODELS.map((m) => ({ id: m.id, name: m.name, efforts: [...m.efforts] })), efforts: [...EFFORTS], presets: PRESET_CHOICES };
}

/** The model and effort a job uses: what it was set to by hand, else the preset's. */
export function modelChoice(settings: Settings, role: Role): ModelChoice {
  const fallback = PRESET_CHOICES[settings.preset][role];
  const model = settings.models[role]?.trim() || fallback.model;
  const wanted = settings.efforts[role] ?? (model === fallback.model ? fallback.effort : (KNOWN_MODELS.find((m) => m.id === model)?.defaultEffort ?? 'high'));
  const allowed = effortsFor(model);
  return { model, effort: allowed.includes(wanted) ? wanted : (allowed[allowed.length - 1] ?? 'high') };
}

/**
 * Read settings from a parsed file that does not pass as a whole: every field (and every role entry)
 * that is valid is kept, the rest fall back to their defaults. One stale entry must never cost the
 * learner their provider, key and data folder.
 */
export function salvageSettings(raw: unknown): Settings {
  const input = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const kept: Record<string, unknown> = {};
  for (const key of ['provider', 'apiKey', 'preset', 'dataFolder', 'concurrency', 'reminderDaily', 'reminderTime', 'iconBadge', 'pythonPath'] as const) {
    const parsed = FIELDS[key].safeParse(input[key]);
    if (parsed.success) kept[key] = parsed.data;
  }
  const entries = (value: unknown, valid: (role: string, v: unknown) => boolean) =>
    Object.fromEntries(Object.entries(typeof value === 'object' && value !== null ? value : {}).filter(([role, v]) => valid(role, v)));
  const isRole = (role: string) => (ROLES as readonly string[]).includes(role);
  kept['models'] = entries(input['models'], (role, v) => isRole(role) && typeof v === 'string');
  kept['efforts'] = entries(input['efforts'], (role, v) => isRole(role) && (EFFORTS as readonly unknown[]).includes(v));
  return SettingsSchema.parse(kept);
}
