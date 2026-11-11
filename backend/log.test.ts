import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppContext } from './context';
import { FakeProvider } from './llm/FakeProvider';
import { CancelledError } from './llm/provider';
import { ThrottledProvider } from './llm/queue';
import { LogFile } from './log';
import { z } from 'zod';

const dir = () => mkdtempSync(join(tmpdir(), 'frontier-log-'));

describe('the log file', () => {
  it('keeps what went wrong, where, and where it was thrown', () => {
    const path = join(dir(), 'nested', 'frontier.log');
    const log = new LogFile(path, 1_000_000, () => new Date('2026-11-11T10:00:00Z'));
    log.info('app', 'started');
    log.error('call goals.compile', new TypeError('no such goal'));
    log.error('notice', "Today's backup could not be written.");
    const lines = readFileSync(path, 'utf8').split('\n');
    expect(lines[0]).toBe('2026-11-11T10:00:00.000Z info [app] started');
    expect(lines[1]).toBe('2026-11-11T10:00:00.000Z error [call goals.compile] TypeError: no such goal');
    expect(lines[2]).toMatch(/^ {4}at /); // the stack, indented under its entry
    expect(lines.some((l) => l.endsWith("error [notice] Today's backup could not be written."))).toBe(true);
  });

  it('starts a new file when it grows large, keeping the one before', () => {
    const path = join(dir(), 'frontier.log');
    const log = new LogFile(path, 200);
    for (let i = 0; i < 12; i += 1) log.info('app', `entry ${i} ${'x'.repeat(30)}`);
    expect(existsSync(`${path}.1`)).toBe(true);
    expect(readFileSync(path, 'utf8').length).toBeLessThan(400);
    expect(readFileSync(path, 'utf8')).toContain('entry 11');
  });

  it('never fails the work it logs, even where it cannot write', () => {
    const log = new LogFile(join('/dev/null', 'no', 'frontier.log'));
    expect(() => log.error('x', new Error('boom'))).not.toThrow();
  });

  it('records a model call that failed with its role, but not one the learner stopped', async () => {
    const failures: string[] = [];
    const inner = new FakeProvider({
      tutor: () => {
        throw new Error('overloaded');
      },
      grader: () => {
        throw new CancelledError();
      },
    });
    const provider = new ThrottledProvider(inner, 2, (role, error) => failures.push(`${role}: ${error instanceof Error ? error.message : String(error)}`));
    const request = (role: 'tutor' | 'grader') => ({ role, system: 's', messages: [{ role: 'user' as const, content: 'q' }], submit: { name: 'submit_x', description: 'd', schema: z.object({}) } });
    await expect(provider.complete(request('tutor'))).rejects.toThrow('overloaded');
    await expect(provider.complete(request('grader'))).rejects.toThrow('cancelled');
    expect(failures).toEqual(['tutor: overloaded']);
  });

  it('writes what the learner is told went wrong in the background', () => {
    const root = dir();
    const ctx = new AppContext('test', join(root, 'settings.json'), join(root, 'data'));
    const sent: string[] = [];
    ctx.sink = (event) => sent.push(event);
    ctx.emit('app.toast', { kind: 'error', message: 'The grade could not be written.' });
    ctx.emit('app.toast', { kind: 'info', message: 'Saved.' });
    ctx.emit('library.progress', { sourceId: 'src_1', status: 'failed', chunkCount: 2, chunksDone: 1, message: 'Part 2 failed: overloaded' });
    ctx.emit('library.progress', { sourceId: 'src_1', status: 'running', chunkCount: 2, chunksDone: 1 });
    const text = readFileSync(join(root, 'frontier.log'), 'utf8');
    expect(text).toContain('error [notice] The grade could not be written.');
    expect(text).toContain('error [source src_1] Part 2 failed: overloaded');
    expect(text).not.toContain('Saved.');
    expect(text.trim().split('\n')).toHaveLength(2);
    expect(sent).toHaveLength(4); // the window still gets every event
    ctx.close();
  });
});
