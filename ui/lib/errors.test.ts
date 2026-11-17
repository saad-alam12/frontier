import { describe, expect, it } from 'vitest';
import { connectionAdvice, plainError } from './errors';

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

describe('connection advice', () => {
  it('says what to do when the Claude login has expired, as it reads on a Mac', () => {
    const error = 'Claude Code returned an error result: Failed to authenticate: OAuth session expired and could not be refreshed';
    expect(connectionAdvice('agentSdk', error)).toMatch(/run claude, type \/login/);
    expect(connectionAdvice('anthropicApi', error)).toBeNull();
  });

  it('says the key was refused for the API provider, and nothing for errors it cannot help with', () => {
    expect(connectionAdvice('anthropicApi', '401 {"type":"error","error":{"type":"authentication_error","message":"Invalid bearer token"}}')).toMatch(/API key was refused/);
    expect(connectionAdvice('agentSdk', 'The model took too long to answer.')).toBeNull();
  });
});
