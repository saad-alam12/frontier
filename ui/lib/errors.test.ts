import { describe, expect, it } from 'vitest';
import { plainError } from './errors';

describe('plain errors', () => {
  it('says what went wrong without the developer details', () => {
    expect(plainError('goalCompiler: submit payload still invalid after 4 attempts: - capabilities.0.targets.0.ref: unknown id node_seed_020')).toBe('The model gave an answer Frontier could not use.');
    expect(plainError('tutor: the model ended without calling the submit tool')).toBe('The model gave an answer Frontier could not use.');
    expect(plainError('529 Overloaded')).toBe('The model is busy or your plan limit is reached for now.');
    expect(plainError('TypeError: fetch failed')).toBe('Frontier could not reach the model. Check the internet connection.');
    expect(plainError('Claude Code is not logged in')).toBe('The model login did not work. Use Test connection in Settings.');
  });

  it('keeps a message written for people, as a sentence', () => {
    expect(plainError('planner: nothing to teach for this goal yet')).toBe('Nothing to teach for this goal yet.');
    expect(plainError('A session is open. Finish or end it first.')).toBe('A session is open. Finish or end it first.');
    expect(plainError('[\n  {\n    "code": "too_small",\n    "path": ["text"],\n    "message": "Paste at least a few sentences."\n  }\n]')).toBe('Paste at least a few sentences.');
  });
});
