/**
 * Running the learner's code with the Python already on their computer (design §4.4, "Code"). Only
 * when they press Run. Frontier keeps a Python environment of its own in the data folder, made from
 * that Python with its libraries visible (`--system-site-packages`): what Frontier installs goes there,
 * never into the system's Python. A well-known library the code needs is installed without asking;
 * any other is offered with its command. When Python itself is missing, the learner gets the commands
 * to run in Terminal (on a Mac, Apple's installer can be opened from the app).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_PLOTS, installsWithoutAsking, isPackageName, keepOutput, missingModule, packageFor } from '../core/code';
import type { CodeRun } from '../core/code';
import { saveImageFile } from '../store/attachments';

export interface ProcessResult {
  /** Null when the process was killed (stopped, or out of time). */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  stopped: boolean;
}

export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** Stop it with `stop(key)`. */
  key?: string;
}

/** Starting and stopping processes; tests give a fake. */
export interface Processes {
  run(command: string, args: string[], options: ProcessOptions): Promise<ProcessResult>;
  stop(key: string): boolean;
}

/** Output kept from a process before it is cut (the end is what is kept with an answer). */
const MAX_CAPTURE = 400_000;

/** Child processes, each in a group of its own so Stop also ends what it started (a pool of workers). */
export class ChildProcesses implements Processes {
  private readonly running = new Map<string, () => void>();

  run(command: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let stopped = false;
      const posix = process.platform !== 'win32';
      const child = spawn(command, args, { cwd: options.cwd, env: options.env, detached: posix, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const kill = () => {
        try {
          if (posix && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {
          // already gone
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, options.timeoutMs);
      if (options.key)
        this.running.set(options.key, () => {
          stopped = true;
          kill();
        });
      const take = (text: string, chunk: Buffer) => (text.length > MAX_CAPTURE ? text : text + chunk.toString('utf8'));
      child.stdout?.on('data', (chunk: Buffer) => (stdout = take(stdout, chunk)));
      child.stderr?.on('data', (chunk: Buffer) => (stderr = take(stderr, chunk)));
      const done = (code: number | null, error?: Error) => {
        clearTimeout(timer);
        if (options.key) this.running.delete(options.key);
        resolve({ code: timedOut || stopped ? null : code, stdout, stderr: error ? `${stderr}${error.message}` : stderr, timedOut, stopped });
      };
      child.on('error', (error) => done(-1, error));
      child.on('close', (code) => done(code));
    });
  }

  stop(key: string): boolean {
    const stop = this.running.get(key);
    stop?.();
    return Boolean(stop);
  }
}

/** What pressing Run came to. */
export interface RunOutcome {
  /** `ran`: it ran (perhaps with an error of its own); the others say why it did not. */
  status: 'ran' | 'no-python' | 'missing' | 'install-failed';
  run: CodeRun | null;
  /** Libraries installed for this run, before it ran. */
  installed: string[];
  /** A library the code needs that is not installed and was not installed without asking. */
  missing: { module: string; package: string } | null;
  /** A plain sentence when it did not run. */
  message: string | null;
  /** Commands the learner can run in Terminal instead. */
  commands: string[];
}

export interface InstallOutcome {
  ok: boolean;
  message: string | null;
  commands: string[];
}

export interface PythonInfo {
  /** The Python Frontier found (or the one Settings names), and its version. */
  python: string | null;
  version: string | null;
  /** Frontier's own environment, once made. */
  environment: string | null;
}

export interface CodeRunnerOptions {
  /** Frontier's Python environment (the data folder's `python/`). */
  envDir: string;
  /** Where plots are kept, like answer images (`attachments/`). */
  attachmentsDir: string;
  /** The Python that Settings names; empty means find one. */
  pythonPath: () => string;
  processes?: Processes;
  /** Seconds a run may take before it is stopped. */
  runSeconds?: number;
}

const RUN_SECONDS = 120;
const INSTALL_SECONDS = 600;
const CHECK_SECONDS = 20;

/** Runs the learner's file and keeps their plots; frames of this wrapper are left out of tracebacks. */
const WRAPPER = `import os, runpy, sys, traceback
HERE = os.path.dirname(os.path.abspath(__file__))
ANSWER = os.path.join(HERE, 'answer.py')
sys.argv = [ANSWER]
sys.path.insert(0, HERE)
status = 0
try:
    runpy.run_path(ANSWER, run_name='__main__')
except SystemExit as stop:
    status = stop.code if isinstance(stop.code, int) else (0 if stop.code is None else 1)
except BaseException:
    kind, value, tb = sys.exc_info()
    while tb is not None and tb.tb_frame.f_code.co_filename != ANSWER:
        tb = tb.tb_next
    traceback.print_exception(kind, value, tb)
    status = 1
finally:
    if 'matplotlib.pyplot' in sys.modules:
        try:
            import matplotlib.pyplot as plt
            for i, number in enumerate(plt.get_fignums()[:${MAX_PLOTS}]):
                plt.figure(number).savefig(os.path.join(HERE, 'plot-%d.png' % (i + 1)), dpi=100, bbox_inches='tight')
        except Exception:
            pass
sys.stdout.flush()
sys.stderr.flush()
sys.exit(status)
`;

export class CodeRunner {
  private readonly processes: Processes;
  /** The Python found, once looked for (null: none); `lookAgain` forgets it. */
  private found: Promise<{ path: string; version: string } | null> | null = null;
  private environment: Promise<{ python: string; ownEnvironment: boolean } | null> | null = null;

  constructor(private readonly options: CodeRunnerOptions) {
    this.processes = options.processes ?? new ChildProcesses();
  }

  /** Forget the Python found and the environment checked (a new Python, or Settings changed). */
  lookAgain(): void {
    this.found = null;
    this.environment = null;
  }

  async info(): Promise<PythonInfo> {
    const found = await this.findPython();
    return { python: found?.path ?? null, version: found?.version ?? null, environment: existsSync(this.envPython()) ? this.options.envDir : null };
  }

  /** Run the code once; a well-known library it misses is installed and the code run again. */
  async run(source: string, key: string): Promise<RunOutcome> {
    const env = await this.ensureEnvironment();
    if (!env) return { status: 'no-python', run: null, installed: [], missing: null, message: noPythonMessage(), commands: installPythonCommands() };
    let run = await this.execute(env.python, source, key);
    const installed: string[] = [];
    const module = run.exitCode !== null && run.exitCode !== 0 ? missingModule(run.stderr) : null;
    if (!module) return { status: 'ran', run, installed, missing: null, message: null, commands: [] };
    const pkg = packageFor(module);
    if (!installsWithoutAsking(pkg) || !isPackageName(pkg)) {
      return { status: 'missing', run, installed, missing: { module, package: pkg }, message: `${module} is not installed.`, commands: [pipCommand(env.python, pkg, env.ownEnvironment)] };
    }
    const install = await this.install(pkg, key);
    if (!install.ok) return { status: 'install-failed', run, installed, missing: { module, package: pkg }, message: install.message, commands: install.commands };
    installed.push(pkg);
    run = await this.execute(env.python, source, key);
    return { status: 'ran', run, installed, missing: null, message: null, commands: [] };
  }

  /** Install one library into Frontier's environment (or for this user, when there is none). */
  async install(pkg: string, key: string): Promise<InstallOutcome> {
    if (!isPackageName(pkg)) return { ok: false, message: `"${pkg}" is not the name of a library.`, commands: [] };
    const env = await this.ensureEnvironment();
    if (!env) return { ok: false, message: noPythonMessage(), commands: installPythonCommands() };
    const args = ['-m', 'pip', 'install', '--disable-pip-version-check', ...(env.ownEnvironment ? [] : ['--user']), pkg];
    const result = await this.processes.run(env.python, args, { timeoutMs: INSTALL_SECONDS * 1000, key, env: { ...process.env, PIP_NO_INPUT: '1' } });
    if (result.code === 0) return { ok: true, message: null, commands: [] };
    const reason = result.stopped ? 'You stopped the install.' : result.timedOut ? 'It took longer than ten minutes.' : lastLines(result.stderr || result.stdout, 4);
    return { ok: false, message: `${pkg} could not be installed. ${reason}`.trim(), commands: [pipCommand(env.python, pkg, env.ownEnvironment)] };
  }

  stop(key: string): boolean {
    return this.processes.stop(key);
  }

  /** Frontier's environment, made once from the Python found; without one, that Python itself. */
  private ensureEnvironment(): Promise<{ python: string; ownEnvironment: boolean } | null> {
    this.environment ??= this.makeEnvironment().catch(() => null);
    return this.environment;
  }

  private async makeEnvironment(): Promise<{ python: string; ownEnvironment: boolean } | null> {
    const base = await this.findPython();
    if (!base) return null;
    const marker = join(this.options.envDir, 'frontier-base.txt');
    const python = this.envPython();
    // an environment made from another Python (Settings changed, or that Python was replaced) is made again
    if (existsSync(python) && existsSync(marker) && readFileSync(marker, 'utf8') === base.path && (await this.check(python))) return { python, ownEnvironment: true };
    rmSync(this.options.envDir, { recursive: true, force: true });
    const made = await this.processes.run(base.path, ['-m', 'venv', '--system-site-packages', this.options.envDir], { timeoutMs: 180_000 });
    if (made.code === 0 && (await this.check(python))) {
      writeFileSync(marker, base.path);
      return { python, ownEnvironment: true };
    }
    // some Pythons cannot make environments (no venv module): run with that Python, install for this user
    rmSync(this.options.envDir, { recursive: true, force: true });
    return { python: base.path, ownEnvironment: false };
  }

  private envPython(): string {
    return process.platform === 'win32' ? join(this.options.envDir, 'Scripts', 'python.exe') : join(this.options.envDir, 'bin', 'python');
  }

  private findPython(): Promise<{ path: string; version: string } | null> {
    this.found ??= this.lookForPython();
    return this.found;
  }

  private async lookForPython(): Promise<{ path: string; version: string } | null> {
    const named = this.options.pythonPath().trim();
    if (named) return this.version(named);
    for (const candidate of await this.candidates()) {
      const found = await this.version(candidate);
      if (found) return found;
    }
    return null;
  }

  /**
   * Where Python 3 is likely to be. An app opened from the Finder does not get the PATH of the learner's
   * Terminal (Homebrew, pyenv, conda), so their login shell is asked first, then the usual places.
   */
  private async candidates(): Promise<string[]> {
    if (process.platform === 'win32') return ['py', 'python', 'python3'];
    const out: string[] = [];
    const shell = process.env['SHELL'] || '/bin/zsh';
    const asked = await this.processes.run(shell, ['-ilc', 'command -v python3'], { timeoutMs: 8000 });
    const fromShell = asked.stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('/')).pop();
    if (fromShell) out.push(fromShell);
    const home = homedir();
    out.push(
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
      '/Library/Frameworks/Python.framework/Versions/Current/bin/python3',
      join(home, '.pyenv', 'shims', 'python3'),
      join(home, 'miniconda3', 'bin', 'python3'),
      join(home, 'anaconda3', 'bin', 'python3'),
      join(home, 'miniforge3', 'bin', 'python3'),
      // last: on a Mac without Apple's command line tools this one offers to install them
      '/usr/bin/python3',
    );
    return [...new Set(out)].filter((p) => p === fromShell || existsSync(p));
  }

  /** The Python at `command` and its version, when it is Python 3 and runs. */
  private async version(command: string): Promise<{ path: string; version: string } | null> {
    const args = command === 'py' ? ['-3', '-c', 'import sys; print(sys.version.split()[0]); print(sys.executable)'] : ['-c', 'import sys; print(sys.version.split()[0]); print(sys.executable)'];
    const result = await this.processes.run(command, args, { timeoutMs: CHECK_SECONDS * 1000 });
    const [version, executable] = result.stdout.trim().split('\n').map((l) => l.trim());
    if (result.code !== 0 || !version?.startsWith('3.')) return null;
    return { path: command === 'py' && executable ? executable : command, version };
  }

  private async check(python: string): Promise<boolean> {
    return (await this.processes.run(python, ['-c', 'import sys'], { timeoutMs: CHECK_SECONDS * 1000 })).code === 0;
  }

  /** Run the source in a folder of its own, then keep its output and plots and remove the folder. */
  private async execute(python: string, source: string, key: string): Promise<CodeRun> {
    mkdirSync(tmpdir(), { recursive: true });
    const dir = mkdtempSync(join(tmpdir(), 'frontier-run-'));
    try {
      writeFileSync(join(dir, 'answer.py'), source, 'utf8');
      writeFileSync(join(dir, 'runner.py'), WRAPPER, 'utf8');
      const env = { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', MPLBACKEND: 'Agg', PYTHONDONTWRITEBYTECODE: '1' };
      const result = await this.processes.run(python, [join(dir, 'runner.py')], { cwd: dir, env, timeoutMs: (this.options.runSeconds ?? RUN_SECONDS) * 1000, key });
      // tracebacks name the file the learner wrote, not the folder it ran in
      const tidy = (text: string) => text.split(`${dir}/`).join('').split(`${dir}\\`).join('');
      const plots = readdirSync(dir)
        .filter((f) => /^plot-\d+\.png$/.test(f))
        .sort()
        .slice(0, MAX_PLOTS)
        .map((f) => saveImageFile(this.options.attachmentsDir, readFileSync(join(dir, f)), 'image/png'));
      const stderr = tidy(result.stderr) + (result.timedOut ? `\nStopped after ${this.options.runSeconds ?? RUN_SECONDS} seconds.` : result.stopped ? '\nStopped.' : '');
      return { exitCode: result.code, stdout: keepOutput(tidy(result.stdout)), stderr: keepOutput(stderr.trimStart()), timedOut: result.timedOut, plots };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function noPythonMessage(): string {
  return process.platform === 'darwin'
    ? 'Python 3 is not on this Mac yet. Install Apple\'s command line tools (they include Python 3), or Python from python.org, then press Run again.'
    : 'Python 3 is not on this computer yet. Install it, then press Run again.';
}

/** What the learner can run in Terminal to get Python 3. */
export function installPythonCommands(): string[] {
  if (process.platform === 'darwin') return ['xcode-select --install', 'brew install python'];
  if (process.platform === 'win32') return ['winget install Python.Python.3.12'];
  return ['sudo apt install python3 python3-venv'];
}

function pipCommand(python: string, pkg: string, ownEnvironment: boolean): string {
  return `"${python}" -m pip install ${ownEnvironment ? '' : '--user '}${pkg}`;
}

function lastLines(text: string, n: number): string {
  return text.trim().split('\n').slice(-n).join(' ').replace(/\s+/g, ' ').slice(0, 400);
}
