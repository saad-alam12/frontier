import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeProvider } from './FakeProvider';
import { NoSubmitError, SubmitValidationError, defineTool } from './provider';
import type { CompleteRequest } from './provider';
import { runConnectionTest } from '../agents/connectionTest';

const Reply = z.object({ answer: z.number(), note: z.string() });

describe('FakeProvider submit loop', () => {
  it('returns a validated payload', async () => {
    const fake = new FakeProvider({ connectionTest: [{ answer: 42, note: 'ok' }] });
    const result = await fake.complete({
      role: 'connectionTest',
      system: 's',
      messages: [{ role: 'user', content: 'q' }],
      submit: { name: 'submit', description: 'd', schema: Reply },
    });
    expect(result.data).toEqual({ answer: 42, note: 'ok' });
    expect(result.attempts).toBe(1);
  });

  it('retries invalid payloads and reports attempts', async () => {
    const fake = new FakeProvider({ connectionTest: [{ answer: 'no' }, { answer: 1 }, { answer: 2, note: 'third' }] });
    const result = await fake.complete({
      role: 'connectionTest',
      system: 's',
      messages: [{ role: 'user', content: 'q' }],
      submit: { name: 'submit', description: 'd', schema: Reply },
    });
    expect(result.data.note).toBe('third');
    expect(result.attempts).toBe(3);
  });

  it('gives up after max retries', async () => {
    const fake = new FakeProvider({ connectionTest: [{ bad: true }] });
    await expect(
      fake.complete({
        role: 'connectionTest',
        system: 's',
        messages: [{ role: 'user', content: 'q' }],
        submit: { name: 'submit', description: 'd', schema: Reply },
      }),
    ).rejects.toBeInstanceOf(SubmitValidationError);
  });

  it('throws when no script exists for the role', async () => {
    const fake = new FakeProvider();
    await expect(
      fake.complete({ role: 'tutor', system: 's', messages: [], submit: { name: 'submit', description: 'd', schema: Reply } }),
    ).rejects.toBeInstanceOf(NoSubmitError);
  });

  it('runs helper tools from the script', async () => {
    const fake = new FakeProvider({
      librarian: [
        { callTool: { name: 'lookup', input: { q: 'x' } } },
        (req: CompleteRequest<unknown>) => ({ answer: req.messages.length, note: 'used tool' }),
      ],
    });
    const result = await fake.complete({
      role: 'librarian',
      system: 's',
      messages: [{ role: 'user', content: 'q' }],
      tools: [defineTool('lookup', 'd', z.object({ q: z.string() }), async (i) => `found ${i.q}`)],
      submit: { name: 'submit', description: 'd', schema: Reply },
    });
    expect(result.data.note).toBe('used tool');
    expect(fake.calls[0]?.toolCalls[0]?.output).toBe('found x');
  });
});

describe('connection test', () => {
  it('passes with a correct structured reply', async () => {
    const fake = new FakeProvider({ connectionTest: [{ greeting: 'hi', sum: 42, modelSelfReport: 'fake' }] });
    const result = await runConnectionTest(fake);
    expect(result.ok).toBe(true);
    expect(result.reply?.sum).toBe(42);
  });

  it('fails cleanly on a wrong sum', async () => {
    const fake = new FakeProvider({ connectionTest: [{ greeting: 'hi', sum: 1, modelSelfReport: 'fake' }] });
    const result = await runConnectionTest(fake);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/expected sum/);
  });
});
