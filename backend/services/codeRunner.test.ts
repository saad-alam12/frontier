import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { codeForModel, installsWithoutAsking, keepOutput, missingModule, packageFor } from '../core/code';
import { ChildProcesses, CodeRunner } from './codeRunner';
import type { ProcessOptions, ProcessResult, Processes } from './codeRunner';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const ok = (stdout = '', stderr = ''): ProcessResult => ({ code: 0, stdout, stderr, timedOut: false, stopped: false });
const failed = (stderr: string, code = 1): ProcessResult => ({ code, stdout: '', stderr, timedOut: false, stopped: false });

/**
 * A computer without real processes: one Python at /usr/local/bin/python3 (or none), a venv that can
 * be made, pip that installs into a set, and `answer.py` read to decide what a run prints.
 */
class FakeComputer implements Processes {
  readonly calls: { command: string; args: string[] }[] = [];
  readonly installed = new Set<string>();
  python: string | null = '/usr/local/bin/python3';
  pipFails = false;
  private readonly stops = new Map<string, () => void>();

  async run(command: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
    this.calls.push({ command, args });
    if (args[0] === '-ilc') return ok(this.python ? `Welcome back\n${this.python}\n` : '');
    if (args[0] === '-c') return command === this.python || command.endsWith('/bin/python') ? ok('3.12.4\n' + command) : failed('not found', 127);
    if (args.includes('venv')) {
      const env = args[args.length - 1] as string;
      mkdirSync(join(env, 'bin'), { recursive: true });
      writeFileSync(join(env, 'bin', 'python'), '');
      return ok();
    }
    if (args.includes('pip')) {
      if (this.pipFails) return failed('ERROR: Could not find a version that satisfies the requirement\nERROR: No matching distribution found');
      this.installed.add(args[args.length - 1] as string);
      return ok('Successfully installed');
    }
    const source = readFileSync(join(options.cwd as string, 'answer.py'), 'utf8');
    if (source.includes('forever')) {
      return new Promise((resolve) => this.stops.set(options.key as string, () => resolve({ code: null, stdout: 'started\n', stderr: '', timedOut: false, stopped: true })));
    }
    for (const lib of ['numpy', 'frontier_lookalike']) {
      if (source.includes(`import ${lib}`) && !this.installed.has(lib)) return failed(`Traceback (most recent call last):\n  File "${options.cwd}/answer.py", line 1, in <module>\nModuleNotFoundError: No module named '${lib}'`);
    }
    if (source.includes('plot')) writeFileSync(join(options.cwd as string, 'plot-1.png'), PNG);
    return ok('6\n');
  }

  stop(key: string): boolean {
    const stop = this.stops.get(key);
    this.stops.delete(key);
    stop?.();
    return Boolean(stop);
  }
}

function setup(computer = new FakeComputer(), pythonPath = '') {
  const dir = mkdtempSync(join(tmpdir(), 'frontier-code-'));
  const attachmentsDir = join(dir, 'attachments');
  const runner = new CodeRunner({ envDir: join(dir, 'python'), attachmentsDir, pythonPath: () => pythonPath, processes: computer });
  return { dir, runner, computer, attachmentsDir };
}

describe('running code (B19)', () => {
  it('runs the code with the Python found, in an environment of Frontier\'s own, and keeps its output and plots', async () => {
    const { runner, computer, dir, attachmentsDir } = setup();
    const outcome = await runner.run('print(2 * 3)\nplot()', 'k1');
    expect(outcome).toMatchObject({ status: 'ran', run: { exitCode: 0, stdout: '6\n', timedOut: false }, installed: [] });
    expect(outcome.run?.plots).toHaveLength(1);
    expect(readdirSync(attachmentsDir)).toEqual(outcome.run?.plots);
    // the environment is made once, from that Python, with its libraries visible
    expect(computer.calls.find((c) => c.args.includes('venv'))).toEqual({ command: '/usr/local/bin/python3', args: ['-m', 'venv', '--system-site-packages', join(dir, 'python')] });
    const runs = computer.calls.filter((c) => c.args[0]?.endsWith('runner.py'));
    expect(runs[0]?.command).toBe(join(dir, 'python', 'bin', 'python'));
    await runner.run('print(1)', 'k2');
    expect(computer.calls.filter((c) => c.args.includes('venv'))).toHaveLength(1);
  });

  it('installs a well-known library the code needs, then runs it again', async () => {
    const { runner, computer } = setup();
    const outcome = await runner.run('import numpy\nprint(numpy.ones(3).sum())', 'k');
    expect(outcome).toMatchObject({ status: 'ran', installed: ['numpy'], run: { exitCode: 0 } });
    expect(computer.calls.find((c) => c.args.includes('pip'))?.args).toEqual(['-m', 'pip', 'install', '--disable-pip-version-check', 'numpy']);
  });

  it('offers any other missing library with its command instead of installing it', async () => {
    const { runner, computer, dir } = setup();
    const outcome = await runner.run('import frontier_lookalike', 'k');
    expect(outcome).toMatchObject({ status: 'missing', missing: { module: 'frontier_lookalike', package: 'frontier_lookalike' }, message: 'frontier_lookalike is not installed.' });
    expect(outcome.commands).toEqual([`"${join(dir, 'python', 'bin', 'python')}" -m pip install frontier_lookalike`]);
    expect(computer.calls.some((c) => c.args.includes('pip'))).toBe(false);
    expect(await runner.install('frontier_lookalike', 'k')).toEqual({ ok: true, message: null, commands: [] });
    expect((await runner.run('import frontier_lookalike', 'k')).status).toBe('ran');
    expect((await runner.install('rm -rf', 'k')).ok).toBe(false); // not a library name
  });

  it('says what to run in Terminal when an install fails', async () => {
    const computer = new FakeComputer();
    computer.pipFails = true;
    const { runner } = setup(computer);
    const outcome = await runner.run('import numpy', 'k');
    expect(outcome.status).toBe('install-failed');
    expect(outcome.message).toContain('numpy could not be installed. ERROR: Could not find a version');
    expect(outcome.commands[0]).toMatch(/"-m pip install numpy$|" -m pip install numpy$/);
  });

  it('with no Python on the computer, says so and gives the commands to install it', async () => {
    const computer = new FakeComputer();
    computer.python = null;
    const { runner } = setup(computer);
    const outcome = await runner.run('print(1)', 'k');
    expect(outcome.status).toBe('no-python');
    expect(outcome.message).toMatch(/^Python 3 is not on this/);
    expect(outcome.commands.length).toBeGreaterThan(0);
    expect(await runner.info()).toMatchObject({ python: null, version: null });
  });

  it('uses the Python Settings name, and makes the environment again when that Python changes', async () => {
    const computer = new FakeComputer();
    computer.python = '/opt/homebrew/bin/python3';
    let named = '/opt/homebrew/bin/python3';
    const dir = mkdtempSync(join(tmpdir(), 'frontier-code-'));
    const runner = new CodeRunner({ envDir: join(dir, 'python'), attachmentsDir: join(dir, 'a'), pythonPath: () => named, processes: computer });
    await runner.run('print(1)', 'k');
    expect(await runner.info()).toMatchObject({ python: '/opt/homebrew/bin/python3', version: '3.12.4' });
    expect(computer.calls.some((c) => c.args[0] === '-ilc')).toBe(false); // no need to look
    named = '/usr/local/bin/python3';
    computer.python = named;
    runner.lookAgain();
    await runner.run('print(1)', 'k');
    expect(computer.calls.filter((c) => c.args.includes('venv')).map((c) => c.command)).toEqual(['/opt/homebrew/bin/python3', '/usr/local/bin/python3']);
  });

  it('Stop ends a run that would not end', async () => {
    const { runner } = setup();
    const running = runner.run('while True: forever()', 'stop-me');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runner.stop('stop-me')).toBe(true);
    const outcome = await running;
    expect(outcome.run).toMatchObject({ exitCode: null, stdout: 'started\n', stderr: 'Stopped.' });
    expect(runner.stop('stop-me')).toBe(false);
  });

  it('reads a missing module from Python\'s message and knows the libraries whose names differ', () => {
    expect(missingModule("Traceback ...\nModuleNotFoundError: No module named 'sklearn.linear_model'")).toBe('sklearn');
    expect(missingModule('NameError: name x is not defined')).toBeNull();
    expect(packageFor('sklearn')).toBe('scikit-learn');
    expect(packageFor('PIL')).toBe('Pillow');
    expect(packageFor('numpy')).toBe('numpy');
    expect(installsWithoutAsking('scikit-learn')).toBe(true);
    expect(installsWithoutAsking('nump')).toBe(false);
    expect(keepOutput('x'.repeat(10), 4)).toBe('… (6 characters left out)\nxxxx');
  });

  it('gives the model the code, whether it ran, its output and its plots', () => {
    const text = codeForModel({ language: 'python', source: 'print(6)', run: { exitCode: 1, stdout: '6\n', stderr: 'ValueError: no', timedOut: false, plots: [`${'a'.repeat(64)}.png`] } });
    expect(text).toContain('```python\nprint(6)\n```');
    expect(text).toContain('The learner ran it; it ended with an error (exit code 1).');
    expect(text).toContain('Errors:\n```\nValueError: no\n```');
    expect(text).toContain('It drew a plot, attached as an image.');
    expect(codeForModel({ language: 'python', source: 'x = 1' })).toContain('The learner did not run this code.');
  });
});

/** The real thing, where a plain Python 3 is at hand (Linux, as on the checks on GitHub); a Mac may ask to install tools on first use. */
function realPython(): string | null {
  if (process.platform !== 'linux') return null;
  try {
    const path = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', timeout: 10_000 }).trim();
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

const python = realPython();

describe.runIf(python)('running code with a real Python (B19)', () => {
  it('runs, shows errors at the learner\'s own lines, stops at the time limit, and names a missing module', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontier-code-real-'));
    const runner = new CodeRunner({ envDir: join(dir, 'python'), attachmentsDir: join(dir, 'attachments'), pythonPath: () => python ?? '', processes: new ChildProcesses(), runSeconds: 2 });
    const fine = await runner.run('import sys\nprint(sum(range(4)))\nprint("warn", file=sys.stderr)', 'a');
    expect(fine).toMatchObject({ status: 'ran', run: { exitCode: 0, stdout: '6\n', stderr: 'warn\n' } });
    expect(existsSync(join(dir, 'python', 'bin', 'python'))).toBe(true);

    const broken = await runner.run('x = 1\nprint(1 / 0)', 'b');
    expect(broken.run?.exitCode).toBe(1);
    expect(broken.run?.stderr).toContain('File "answer.py", line 2, in <module>');
    expect(broken.run?.stderr).toContain('ZeroDivisionError: division by zero');
    expect(broken.run?.stderr).not.toContain('runner.py');
    expect(broken.run?.stderr).not.toContain(dirname(dir));

    const slow = await runner.run('while True:\n    pass', 'c');
    expect(slow.run).toMatchObject({ exitCode: null, timedOut: true });
    expect(slow.run?.stderr).toContain('Stopped after 2 seconds.');

    const missing = await runner.run('import frontier_module_that_does_not_exist', 'd');
    expect(missing).toMatchObject({ status: 'missing', missing: { module: 'frontier_module_that_does_not_exist' } });

    const exits = await runner.run('import sys\nsys.exit(3)', 'e');
    expect(exits.run?.exitCode).toBe(3);
  }, 60_000);
});
