import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildStepSchema } from '../agents/tutor';
import { requestBody } from './AnthropicApiProvider';
import type { CompleteRequest } from './provider';

const req = (schema: z.ZodType, content = 'Grade this.'): CompleteRequest<unknown> => ({ role: 'tutor', system: 'You are the tutor.', messages: [{ role: 'user', content }], submit: { name: 'submit_step', description: 'Submit.', schema } });

describe('prompt caching on the API provider (R7 C1)', () => {
  it('marks the system prompt (which caches the tools before it) and the end of the conversation', () => {
    const body = requestBody(req(z.object({ x: z.string() })), { model: 'claude-opus-5-5', effort: 'medium' }, [{ role: 'user', content: 'Grade this.' }]);
    expect(body.system).toEqual([{ type: 'text', text: expect.stringContaining('You are the tutor.'), cache_control: { type: 'ephemeral' } }]);
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.tools?.map((t) => ('name' in t ? t.name : ''))).toEqual(['submit_step']);
  });

  it('every tutor call shows the model the same tool, whatever card it may write, so the cached part holds', () => {
    const tools = [
      buildStepSchema('explain', false),
      buildStepSchema(['check', 'compress', null], true, new Set(['card_1'])),
      buildStepSchema('support', false, new Set(), new Set(['fig_a'])),
    ].map((schema) => JSON.stringify(requestBody(req(schema), { model: 'claude-opus-5-5', effort: 'medium' }, []).tools));
    expect(new Set(tools).size).toBe(1);
  });

  it('what a call may submit is still checked, and a mistake says what to write', () => {
    const schema = buildStepSchema(['check', 'compress'], true);
    const grade = { score: 0.8, feedback: 'Right.', misconception: null, confidentlyWrong: false, missingBackground: null, recalledCards: [] };
    const compress = { stage: 'compress', prompt: 'In your own words.' };
    expect(schema.safeParse({ grade, card: compress }).success).toBe(true);
    expect(schema.safeParse({ grade: null, card: compress }).error?.issues[0]?.message).toBe("grade the learner's response");
    expect(schema.safeParse({ grade, card: null }).error?.issues[0]?.message).toBe('write the **check** or **compress** card');
    expect(schema.safeParse({ grade, card: { stage: 'explain', markdown: 'More.' } }).error?.issues[0]?.message).toBe('the card must be the **check** or **compress** card, not explain');
    expect(buildStepSchema('explain', false).safeParse({ grade, card: { stage: 'explain', markdown: 'x' } }).error?.issues[0]?.message).toBe('there is no response to grade here: grade must be null');
  });
});
