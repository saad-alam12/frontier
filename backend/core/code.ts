/**
 * Code in an answer (design §4.4, "Code"): Python the learner wrote, and what its last run printed.
 * Pure: the schemas are shared by the renderer and the backend; running is `services/codeRunner.ts`.
 */
import { z } from 'zod';

export const MAX_CODE_CHARS = 20_000;
/** Output kept with an answer and shown to the model, per stream. */
export const MAX_KEPT_OUTPUT = 4_000;
/** Plots a run keeps (as images in attachments/), so the tutor can see them too. */
export const MAX_PLOTS = 4;

/** What one run of the code gave, as kept with the answer. */
export const CodeRunSchema = z.object({
  /** The exit code; null when the run was stopped or ran out of time. */
  exitCode: z.number().int().nullable(),
  stdout: z.string().max(MAX_KEPT_OUTPUT + 200),
  stderr: z.string().max(MAX_KEPT_OUTPUT + 200),
  timedOut: z.boolean().default(false),
  /** Plots the code drew, stored like answer images (PNG files named by their content). */
  plots: z.array(z.string().regex(/^[a-f0-9]{64}\.png$/, 'not a stored plot')).max(MAX_PLOTS).default([]),
});
export type CodeRun = z.infer<typeof CodeRunSchema>;

export const CodeAnswerSchema = z.object({
  language: z.literal('python'),
  source: z.string().max(MAX_CODE_CHARS, `Code can be up to ${MAX_CODE_CHARS.toLocaleString('en')} characters.`),
  /** The last run of exactly this source; absent when it was not run (or changed since). */
  run: CodeRunSchema.nullable().optional(),
});
export type CodeAnswer = z.infer<typeof CodeAnswerSchema>;

/** Starter code a question offers when it is answered in code (the tutor or the problem generator writes it). */
export const CodeStarterSchema = z.object({
  language: z.literal('python'),
  starter: z.string().max(4000).default(''),
});
export type CodeStarter = z.infer<typeof CodeStarterSchema>;

/** Keep the end of long output: an error and its last lines matter most. */
export function keepOutput(text: string, max = MAX_KEPT_OUTPUT): string {
  if (text.length <= max) return text;
  return `… (${(text.length - max).toLocaleString('en')} characters left out)\n${text.slice(text.length - max)}`;
}

/** The module a run could not import, from Python's own message; null when that is not what failed. */
export function missingModule(stderr: string): string | null {
  const found = /ModuleNotFoundError: No module named '([A-Za-z_][\w.]*)'/.exec(stderr);
  return found ? (found[1] as string).split('.')[0] ?? null : null;
}

/** Where the name to import and the name to install differ. */
const PACKAGE_FOR: Record<string, string> = {
  sklearn: 'scikit-learn',
  skimage: 'scikit-image',
  cv2: 'opencv-python',
  PIL: 'Pillow',
  yaml: 'PyYAML',
  bs4: 'beautifulsoup4',
  dateutil: 'python-dateutil',
  Crypto: 'pycryptodome',
  dotenv: 'python-dotenv',
  serial: 'pyserial',
  attr: 'attrs',
  jwt: 'PyJWT',
  OpenGL: 'PyOpenGL',
  google: 'google-api-python-client',
};

export function packageFor(module: string): string {
  return PACKAGE_FOR[module] ?? module;
}

/**
 * Libraries a course or a tutor commonly asks for, installed without asking when code needs one. Any
 * other missing module is offered as a button with its command, since an import name that is not a
 * well-known library may be a typo or a lookalike package.
 */
const WELL_KNOWN = new Set([
  'numpy', 'pandas', 'matplotlib', 'scipy', 'scikit-learn', 'scikit-image', 'sympy', 'seaborn', 'statsmodels', 'networkx',
  'torch', 'torchvision', 'tensorflow', 'jax', 'jaxlib', 'transformers', 'Pillow', 'opencv-python', 'requests', 'beautifulsoup4',
  'PyYAML', 'tqdm', 'numba', 'plotly', 'polars', 'pyarrow', 'nltk', 'spacy', 'gensim', 'xgboost', 'lightgbm', 'cvxpy',
  'python-dateutil', 'pytest', 'attrs', 'einops', 'tiktoken', 'datasets', 'gymnasium', 'shapely', 'pulp',
]);

export function installsWithoutAsking(pkg: string): boolean {
  return WELL_KNOWN.has(pkg);
}

/** A name pip can take as it is: letters, digits, dots, dashes and underscores. */
export function isPackageName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(name);
}

/** The code and what its last run printed, as the tutor or the grader reads it. */
export function codeForModel(code: CodeAnswer): string {
  const lines = ['Code (Python):', '```python', code.source.trimEnd() || '# (empty)', '```'];
  const run = code.run;
  if (!run) lines.push('The learner did not run this code.');
  else {
    const how = run.timedOut ? 'ran out of time' : run.exitCode === null ? 'was stopped' : run.exitCode === 0 ? 'finished without an error' : `ended with an error (exit code ${run.exitCode})`;
    lines.push(`The learner ran it; it ${how}.`);
    if (run.stdout.trim()) lines.push('Output:', '```', run.stdout.trimEnd(), '```');
    if (run.stderr.trim()) lines.push('Errors:', '```', run.stderr.trimEnd(), '```');
    if (run.plots.length) lines.push(`It drew ${run.plots.length === 1 ? 'a plot, attached' : `${run.plots.length} plots, attached`} as ${run.plots.length === 1 ? 'an image' : 'images'}.`);
  }
  return lines.join('\n');
}
