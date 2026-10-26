import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROMPTS_DIR = join(import.meta.dirname, '../../prompts');
const cache = new Map<string, string>();

/** Load a prompt from prompts/<name>.md. All prompts there are written from scratch for this project. */
export function loadPrompt(name: string): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const text = readFileSync(join(PROMPTS_DIR, `${name}.md`), 'utf8');
  cache.set(name, text);
  return text;
}
