import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

/** What went wrong and where it was thrown: the message and the top of the stack. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const stack = (error.stack ?? '')
    .split('\n')
    .slice(1, 6)
    .map((line) => line.trim())
    .join('\n');
  return `${error.name}: ${error.message}${stack ? `\n${stack}` : ''}`;
}

/**
 * The app's log: one entry per event worth looking at later (a start, a failed call, background work
 * that failed). It holds error messages and where they came from, never what the learner wrote, a
 * prompt or a key. It stays small: past a megabyte the file becomes "frontier.log.1" and a new one
 * starts. Writing the log never fails the work that is being logged.
 */
export class LogFile {
  constructor(
    readonly path: string,
    private readonly maxBytes = 1_000_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  info(where: string, message: string): void {
    this.write('info', where, message);
  }

  error(where: string, error: unknown): void {
    this.write('error', where, typeof error === 'string' ? error : describeError(error));
  }

  /** Make sure the file is there, so it can be shown before anything was logged. */
  touch(): void {
    this.append('');
  }

  private write(level: 'info' | 'error', where: string, message: string): void {
    this.append(`${this.now().toISOString()} ${level} [${where}] ${message.replace(/\r?\n/g, '\n    ')}\n`);
  }

  private append(text: string): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      try {
        if (statSync(this.path).size > this.maxBytes) renameSync(this.path, `${this.path}.1`);
      } catch {
        // no log yet
      }
      appendFileSync(this.path, text);
    } catch {
      // a log that cannot be written must not break the app
    }
  }
}
