/**
 * What the window may send, per method (CLAUDE.md, "zod schemas shared between producer and
 * consumer"): every call's input is checked here by the transport before any handler runs, so a
 * handler only ever sees input of the right shape and size. The table is typed by the contract's method
 * names, so a method added without a schema does not compile.
 */
import { z } from 'zod';
import { CONFIDENCE_LEVELS, CONTEXT_MAX_CHARS, GOAL_FOCUS, GOAL_LEVELS, MATERIAL_ROLES } from '../core/types';
import type { MaterialRole } from '../core/types';
import { AttachmentNameSchema, ImageUploadSchema, MAX_IMAGES, MAX_QUOTE_CHARS } from '../core/attachments';
import { CodeAnswerSchema, MAX_CODE_CHARS } from '../core/code';
import { ASIDE_MODES } from '../agents/tutor';
import { SettingsPatchSchema } from '../settings/schema';
import { CardInputSchema, DraftRequestSchema, GoalCardSettingsSchema, ReviewInputSchema } from '../services/cards';
import { EraseRequestSchema } from '../services/erase';
import { FigureRequestSchema } from '../services/figures';
import { FreeChoiceSchema } from '../services/freeSession';
import { PastedTextSchema } from '../services/library';
import { NOTE_CHARS } from '../services/notes';
import { NAME_CHARS, STATEMENT_CHARS } from '../services/mapEdit';
import { ASIDE_MAX_CHARS } from '../services/session';
import { STATS_RANGES } from '../services/stats';
import { MAX_TURNS, SELECTED_MAX_CHARS } from '../services/lookup';
import type { ApiInput, ApiName } from './contract';

const none = z.undefined();
/** An id the backend made (`goal_…`, `node_…`): never empty, never long. */
const id = z.string().min(1).max(200);
const ids = (max: number) => z.array(id).max(max);
const text = (max: number) => z.string().max(max, `At most ${max.toLocaleString('en-GB')} characters.`);
const goalOnly = z.object({ goalId: id });
const nodeOnly = z.object({ nodeId: id });
const sourceOnly = z.object({ sourceId: id });
const sessionOnly = z.object({ sessionId: id });
const setOnly = z.object({ setId: id });
const dialogueOnly = z.object({ dialogueId: id });
const cardOnly = z.object({ cardId: id });
/** A calendar date as the date field gives it, and a real one: "2026-02-30" is refused. */
const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'A date, like 2026-12-18.')
  .refine((d) => {
    const [y, m, day] = d.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, day));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === day;
  }, 'That date does not exist.');
const confidence = z.number().refine((c) => CONFIDENCE_LEVELS.some((l) => Math.abs(l.value - c) < 0.01), 'Not one of the confidence choices.');

const GoalBudgetSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('total'), hours: z.number().positive().max(10_000) }),
  z.object({ mode: z.literal('rate'), hours: z.number().positive().max(1_000), per: z.enum(['day', 'week']), length: z.number().positive().max(1_000), lengthUnit: z.enum(['days', 'weeks', 'months']) }),
  z.object({ mode: z.literal('resource'), hours: z.number().positive().max(100) }),
]);

const GoalFields = {
  text: z.string().trim().min(1, 'Say what you want to learn.').max(2_000),
  kind: z.enum(['course', 'personal']).optional(),
  assessment: z.enum(['written_exam', 'oral_exam', 'presentation_or_project', 'outcome', 'none']).optional(),
  targetGrade: text(100).nullable().optional(),
  date: localDate.nullable().optional(),
  budget: GoalBudgetSchema.nullable().optional(),
  wantedLevel: z.enum(GOAL_LEVELS).nullable().optional(),
  focus: z.array(z.enum(GOAL_FOCUS)).max(GOAL_FOCUS.length).optional(),
  priority: z.number().min(0).max(100).optional(),
  background: text(1_000).nullable().optional(),
  context: text(CONTEXT_MAX_CHARS).nullable().optional(),
  materials: z.array(z.object({ sourceId: id, role: z.enum(MATERIAL_ROLES as readonly [MaterialRole, ...MaterialRole[]]) })).max(500),
};
const GoalFormSchema = z.object(GoalFields);

const LearnerResponseSchema = z.object({
  answer: text(20_000),
  confidence: confidence.optional(),
  effort: z.number().int().min(1).max(5).optional(),
  handle: text(200).optional(),
  testMe: z.boolean().optional(),
  attachments: z.array(AttachmentNameSchema).max(MAX_IMAGES).optional(),
  quote: text(MAX_QUOTE_CHARS).optional(),
  code: CodeAnswerSchema.optional(),
});

export const INPUTS = {
  'app.info': none,
  'app.showLog': none,
  'backups.list': none,
  'backups.create': none,
  'backups.restore': z.object({ file: z.string().min(1).max(300) }),
  'backups.showFolder': none,
  'settings.get': none,
  'settings.update': SettingsPatchSchema,
  'settings.modelOptions': none,
  'settings.testConnection': none,
  'settings.chooseFolder': none,
  'settings.usage': none,
  'library.list': none,
  'library.addFiles': none,
  'library.addPaths': z.object({ paths: z.array(z.string().min(1).max(4_096)).max(200) }),
  'library.stop': sourceOnly,
  'library.openOriginal': sourceOnly,
  'library.addText': PastedTextSchema,
  'library.addLink': z.object({ url: z.string().trim().min(1).max(2_000) }),
  'library.run': sourceOnly,
  'library.remove': sourceOnly,
  'library.reread': sourceOnly,
  'library.delta': sourceOnly,
  'library.document': sourceOnly,
  'library.watchedFolders': none,
  'library.watchFolder': z.object({ goalId: id.nullable().default(null) }),
  'library.unwatchFolder': z.object({ path: z.string().min(1).max(4_096) }),
  'library.scanFolders': none,
  'goals.list': none,
  'goals.get': goalOnly,
  'goals.exportNotes': goalOnly,
  'goals.create': z.object({ form: GoalFormSchema, draft: z.boolean().optional() }),
  'goals.preview': z.object({ goalId: id, budget: GoalBudgetSchema.nullable() }),
  'goals.approve': goalOnly,
  'goals.update': z.object({ goalId: id, form: GoalFormSchema.partial().extend({ status: z.enum(['active', 'paused', 'done']).optional() }) }),
  'goals.useFreedTime': goalOnly,
  'goals.setStatus': z.object({ goalId: id, status: z.enum(['active', 'paused', 'done']) }),
  'goals.remove': goalOnly,
  'goals.compile': goalOnly,
  'goals.remapView': goalOnly,
  'goals.remapApprove': goalOnly,
  'goals.remapDismiss': goalOnly,
  'goals.goDeeper': z.object({ goalId: id, nodeIds: ids(100).optional() }),
  'goals.remapRequest': goalOnly,
  'goals.additionRequest': z.object({ goalId: id, request: z.string().trim().min(1, 'Say what to add.').max(2_000) }),
  'goals.additionView': goalOnly,
  'goals.additionApprove': goalOnly,
  'goals.additionDismiss': goalOnly,
  'goals.startUnverified': z.object({ goalId: id, nodeId: id }),
  'notes.goal': goalOnly,
  'notes.sheet': z.object({ goalId: id, all: z.boolean().optional() }),
  'notes.idea': nodeOnly,
  'notes.saveIdea': z.object({ nodeId: id, text: text(NOTE_CHARS) }),
  'notes.print': none,
  'notes.savePdf': z.object({ goalId: id, kind: z.enum(['notes', 'sheet']) }),
  'materials.pick': none,
  'materials.addPaths': z.object({ paths: z.array(z.string().min(1).max(4_096)).max(500) }),
  'probe.create': goalOnly,
  'probe.open': goalOnly,
  'probe.submit': z.object({ probeId: id, answers: z.array(z.object({ problemId: id, answer: text(20_000), confidence: confidence.nullable() })).max(50) }),
  'probe.cancel': z.object({ probeId: id }),
  'plan.preview': goalOnly,
  'session.current': none,
  'session.work': none,
  'session.start': z.object({ goalId: id, focus: ids(50).optional(), minutes: z.number().min(1).max(600).optional() }),
  'session.respond': z.object({ sessionId: id, response: LearnerResponseSchema, draftKey: text(300).optional() }),
  'session.ask': z.object({ sessionId: id, mode: z.enum(ASIDE_MODES), question: text(ASIDE_MAX_CHARS).optional() }),
  'session.freePreview': FreeChoiceSchema,
  'session.make': z.object({ description: z.string().trim().min(1, 'Say what you want to learn.').max(4_000), goalId: id.nullable() }),
  'session.maker': none,
  'session.startFree': FreeChoiceSchema,
  'session.cancel': sessionOnly,
  'session.dismissStart': none,
  'session.pause': sessionOnly,
  'session.end': sessionOnly,
  'today.view': none,
  'practice.current': none,
  'practice.get': setOnly,
  'practice.start': z.object({ goalId: id, kind: z.enum(['compound', 'mock']), nodeIds: ids(40).optional(), level: z.enum(['easier', 'normal', 'harder']).optional(), problems: z.number().int().min(1).max(8).optional() }),
  'practice.submit': z.object({
    problemId: id,
    answer: text(20_000),
    confidence: confidence.nullable(),
    code: CodeAnswerSchema.optional(),
    attachments: z.array(AttachmentNameSchema).max(MAX_IMAGES).optional(),
    quote: text(MAX_QUOTE_CHARS).optional(),
  }),
  'practice.handIn': setOnly,
  'practice.end': setOnly,
  'dialogue.start': z.object({ goalId: id, kind: z.enum(['oral', 'teach']) }),
  'dialogue.get': dialogueOnly,
  'dialogue.open': goalOnly,
  'dialogue.answer': z.object({ dialogueId: id, answer: text(12_000) }),
  'dialogue.end': dialogueOnly,
  'map.view': none,
  'map.card': nodeOnly,
  'map.erasePreview': EraseRequestSchema,
  'map.erase': EraseRequestSchema,
  'map.editIdea': z.object({ nodeId: id, name: text(NAME_CHARS * 2), statement: text(STATEMENT_CHARS * 2) }),
  'map.mergeCandidates': z.object({ nodeId: id, query: text(200).optional() }),
  'map.mergeIdeas': z.object({ keepId: id, dropId: id }),
  'lookup.search': z.object({
    query: z.string().trim().min(1).max(500),
    history: z.array(z.object({ question: text(500), answer: text(4_000) })).max(MAX_TURNS * 2).optional(),
    // a long selection is cut, never refused
    passage: z.object({ sourceId: id, locator: z.string().max(200).nullable(), text: z.string().trim().min(1).transform((t) => t.slice(0, SELECTED_MAX_CHARS)) }).optional(),
  }),
  'lookup.open': nodeOnly,
  'trails.list': z.object({ nodeId: id.optional() }),
  'trails.get': sessionOnly,
  'activity.tick': z.object({ surface: z.enum(['session', 'practice', 'probe', 'cards', 'lookup', 'map', 'reading']), seconds: z.number().min(0).max(3_600), goalId: id.nullable().optional(), practiceSetId: id.nullable().optional() }),
  'stats.view': z.object({ goalId: id.nullable(), topicId: z.string().max(200).nullable(), range: z.enum(STATS_RANGES) }),
  'stats.misconceptions': none,
  'stats.dismissMisconception': z.object({ bugId: id }),
  'stats.week': z.object({ weekOf: localDate.nullable().default(null) }),
  'drafts.get': z.object({ keys: z.array(z.string().min(1).max(300)).max(100) }),
  'drafts.set': z.object({ key: z.string().min(1).max(300), value: text(200_000) }),
  'attachments.save': ImageUploadSchema,
  'attachments.read': z.object({ name: AttachmentNameSchema }),
  'code.run': z.object({ source: z.string().max(MAX_CODE_CHARS, 'The code is too long to run.'), key: z.string().min(1).max(80) }),
  'code.stop': z.object({ key: z.string().min(1).max(80) }),
  'code.install': z.object({ package: z.string().min(1).max(100), key: z.string().min(1).max(80) }),
  'code.python': z.object({ lookAgain: z.boolean().optional() }),
  'code.installPython': none,
  'figures.read': FigureRequestSchema,
  'cards.queue': z.object({ goalId: id.nullable() }),
  'cards.review': ReviewInputSchema.extend({ cardId: id, goalId: id.nullable() }),
  'cards.undoReview': z.object({ cardId: id, goalId: id.nullable() }),
  'cards.list': z.object({ goalId: id.nullable().optional(), nodeId: id.nullable().optional(), query: text(200).optional() }),
  'cards.save': CardInputSchema,
  'cards.delete': cardOnly,
  'cards.suspend': z.object({ cardId: id, suspended: z.boolean() }),
  'cards.draft': DraftRequestSchema,
  'cards.findIdeas': z.object({ query: text(200) }),
  'cards.summary': z.object({ goalId: id.nullable() }),
  'cards.goalSettings': goalOnly,
  'cards.saveGoalSettings': z.object({ goalId: id, settings: GoalCardSettingsSchema }),
  'cards.preferences': none,
  'cards.savePreferences': z.object({ withoutGoal: z.boolean() }),
  'cards.stats': z.object({ goalId: id.nullable(), range: z.enum(STATS_RANGES) }),
} satisfies { [N in ApiName]: z.ZodType<ApiInput<N>> };

export type CheckedInput = { ok: true; data: unknown } | { ok: false; message: string; field: string };

/** Check one call's input. A refusal says what did not fit in plain words, and which field it was. */
export function checkInput(name: ApiName, input: unknown): CheckedInput {
  const parsed = INPUTS[name].safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, message: issue?.message ?? 'The request does not fit.', field: issue?.path.join('.') ?? '' };
}
