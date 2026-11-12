import { useEffect, useId, useRef, useState } from 'react';
import type { CodeAnswer as CodeAnswerValue, CodeRun, RunOutcome } from '../../backend/api/contract';
import { call } from '../api';
import { plainError } from '../lib/errors';
import { highlightPython } from '../lib/highlight';
import { StoredImage } from './AnswerExtras';
import { Button } from './controls';
import './CodeAnswer.css';

/** The code part of an unsent answer: the source, and the last run with the source it ran. */
export interface CodeDraft {
  source: string;
  run: CodeRun | null;
  ranSource: string | null;
}

/** What goes with the answer: the code, and its last run only when that run was of this very source. */
export function codeOf(draft: CodeDraft | null | undefined): CodeAnswerValue | undefined {
  if (!draft?.source.trim()) return undefined;
  return { language: 'python', source: draft.source, run: draft.ranSource === draft.source ? draft.run : null };
}

const INDENT = '    ';
const errorMessage = (error: unknown) => plainError(error instanceof Error ? error.message : String(error));
/** Apple's installer can be opened from the app on a Mac only. */
const ON_A_MAC = /Mac/.test(navigator.userAgent);

/**
 * Code as part of an answer (design §4.4, "Code"): a Python field with colours, Run to run it with
 * the Python on this computer, and the output and plots under it. Nothing runs until Run is pressed.
 */
export function CodeAnswer({
  draft,
  onChange,
  starter,
  disabled,
  onSubmit,
}: {
  draft: CodeDraft | null;
  onChange: (draft: CodeDraft | null) => void;
  /** Starter code the question offers; the field opens with it. */
  starter?: string;
  disabled?: boolean;
  /** ⌘↵ in the field submits the whole answer. */
  onSubmit: () => void;
}) {
  const open = draft ?? (starter !== undefined ? { source: starter, run: null, ranSource: null } : null);
  const id = useId();
  const runs = useRef(0);
  const [running, setRunning] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setSlow(true), 5000);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [running]);

  if (!open) {
    return (
      <div>
        <Button kind="quiet" onClick={() => onChange({ source: '', run: null, ranSource: null })} disabled={disabled}>
          Answer with code
        </Button>
      </div>
    );
  }

  const run = async () => {
    if (running || !open.source.trim()) return;
    const key = `${id}-${(runs.current += 1)}`;
    setRunning(key);
    setFailure(null);
    setOutcome(null);
    const source = open.source;
    try {
      const result = await call('code.run', { source, key });
      setOutcome(result);
      if (result.run) onChange({ source, run: result.run, ranSource: source });
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setRunning(null);
    }
  };

  const install = async (pkg: string) => {
    const key = `${id}-install-${(runs.current += 1)}`;
    setInstalling(true);
    setRunning(key);
    try {
      const result = await call('code.install', { package: pkg, key });
      if (!result.ok) {
        setOutcome({ status: 'install-failed', run: outcome?.run ?? null, installed: [], missing: outcome?.missing ?? null, message: result.message, commands: result.commands });
        return;
      }
    } catch (error) {
      setFailure(errorMessage(error));
      return;
    } finally {
      setInstalling(false);
      setRunning(null);
    }
    await run();
  };

  const shown = open.ranSource === open.source ? open.run : null;
  const lastRun = outcome?.run ?? shown;
  return (
    <div className="code-answer">
      <CodeField
        value={open.source}
        disabled={disabled}
        onChange={(source) => onChange({ ...open, source })}
        onRun={() => void run()}
        onSubmit={onSubmit}
      />
      <div className="code-toolbar">
        {running ? (
          <Button onClick={() => void call('code.stop', { key: running })}>Stop</Button>
        ) : (
          <Button onClick={() => void run()} disabled={disabled || !open.source.trim()} title="Runs it with the Python on this computer">
            Run
          </Button>
        )}
        <span className="keyboard-hint">⇧⌘↵ to run</span>
        {/* code the question asked for stays; code the learner chose to add can go again */}
        {starter === undefined && (
          <span className="code-toolbar-end">
            <Button kind="quiet" onClick={() => onChange(null)} disabled={disabled || Boolean(running)}>
              Remove code
            </Button>
          </span>
        )}
      </div>
      {running && (
        <p className="t-small m-0 text-secondary" role="status">
          {installing ? 'Installing… this can take a minute.' : slow ? 'Still running. A library it needs may be installing first, which can take a minute.' : 'Running…'}
        </p>
      )}
      {failure && <p className="t-small m-0 text-danger">{failure}</p>}
      {!running && outcome && outcome.installed.length > 0 && <p className="t-small m-0 text-secondary">Installed {outcome.installed.join(', ')} first.</p>}
      {lastRun && <RunOutput run={lastRun} stale={!outcome && open.ranSource !== open.source} />}
      {!running && outcome && outcome.status !== 'ran' && <NotRun outcome={outcome} onInstall={(pkg) => void install(pkg)} />}
    </div>
  );
}

/** The editable code: a plain textarea over a coloured copy of the same text, so typing and dictation work as anywhere. */
function CodeField({ value, disabled, onChange, onRun, onSubmit }: { value: string; disabled?: boolean; onChange: (value: string) => void; onRun: () => void; onSubmit: () => void }) {
  const layer = useRef<HTMLPreElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const lines = Math.min(24, Math.max(6, value.split('\n').length + 1));
  const sync = () => {
    if (layer.current && field.current) {
      layer.current.scrollTop = field.current.scrollTop;
      layer.current.scrollLeft = field.current.scrollLeft;
    }
  };
  return (
    <div className="code-field" style={{ ['--code-lines' as string]: lines }}>
      <pre ref={layer} className="code-layer" aria-hidden="true">
        <code>
          {highlightPython(value).map((token, i) => (
            <span key={i} className={`tok-${token.kind}`}>
              {token.text}
            </span>
          ))}
          {/* a last empty line still takes room, as it does in the field */}
          {'\n'}
        </code>
      </pre>
      <textarea
        ref={field}
        className="code-input"
        aria-label="Your code (Python)"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        wrap="off"
        placeholder="# Python"
        value={value}
        disabled={disabled}
        onScroll={sync}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (e.shiftKey) onRun();
            else onSubmit();
            return;
          }
          // Tab indents; Shift+Tab still leaves the field, so the keyboard is never trapped in it
          if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            const el = e.currentTarget;
            const { selectionStart: start, selectionEnd: end } = el;
            onChange(value.slice(0, start) + INDENT + value.slice(end));
            requestAnimationFrame(() => el.setSelectionRange(start + INDENT.length, start + INDENT.length));
            return;
          }
          // Enter keeps the indentation of the line, one step more after a colon
          if (e.key === 'Enter' && !e.altKey) {
            const el = e.currentTarget;
            const { selectionStart: start, selectionEnd: end } = el;
            const line = value.slice(value.lastIndexOf('\n', start - 1) + 1, start);
            const indent = (/^[ \t]*/.exec(line)?.[0] ?? '') + (line.trimEnd().endsWith(':') ? INDENT : '');
            if (!indent) return;
            e.preventDefault();
            onChange(`${value.slice(0, start)}\n${indent}${value.slice(end)}`);
            requestAnimationFrame(() => el.setSelectionRange(start + 1 + indent.length, start + 1 + indent.length));
          }
        }}
      />
    </div>
  );
}

/** What a run printed, its errors, its plots, and how it ended. */
export function RunOutput({ run, stale }: { run: CodeRun; stale?: boolean }) {
  const ended = run.timedOut ? 'Ran out of time' : run.exitCode === null ? 'Stopped' : run.exitCode === 0 ? 'Finished' : 'Ended with an error';
  const nothing = !run.stdout.trim() && !run.stderr.trim() && run.plots.length === 0;
  return (
    <div className={`code-output${stale ? ' is-stale' : ''}`}>
      <div className="code-output-head t-caption">
        <span>{ended}</span>
        {stale && <span>The code changed since this run. Run it again to send the new output.</span>}
      </div>
      {run.stdout.trim() && <pre className="code-stream">{run.stdout.trimEnd()}</pre>}
      {run.stderr.trim() && <pre className="code-stream is-error">{run.stderr.trimEnd()}</pre>}
      {nothing && <p className="t-small m-0 text-muted">It printed nothing.</p>}
      {run.plots.length > 0 && (
        <ul className="code-plots" aria-label="Plots">
          {run.plots.map((name, i) => (
            <li key={name}>
              <StoredImage name={name} alt={`Plot ${i + 1}`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Why the code did not run, with what the learner can do: install the library, or run commands in Terminal. */
function NotRun({ outcome, onInstall }: { outcome: RunOutcome; onInstall: (pkg: string) => void }) {
  const [opened, setOpened] = useState<string | null>(null);
  return (
    <div className="code-notice">
      {outcome.message && <p className="m-0">{outcome.message}</p>}
      {outcome.status === 'missing' && outcome.missing && (
        <div className="button-row">
          <Button kind="primary" onClick={() => onInstall(outcome.missing?.package ?? '')}>
            Install {outcome.missing.package}
          </Button>
        </div>
      )}
      {outcome.status === 'no-python' && ON_A_MAC && (
        <div className="button-row">
          <Button kind="primary" onClick={() => void call('code.installPython').then((r) => setOpened(r.message), (error: unknown) => setOpened(errorMessage(error)))}>
            Open Apple&rsquo;s installer
          </Button>
        </div>
      )}
      {opened && <p className="t-small m-0 text-secondary">{opened}</p>}
      {outcome.commands.length > 0 && (
        <div className="flex flex-col gap-[6px]">
          <span className="t-small text-secondary">{outcome.status === 'missing' ? 'Or run this in Terminal:' : outcome.commands.length === 1 ? 'You can run this in Terminal:' : 'You can run one of these in Terminal:'}</span>
          {outcome.commands.map((command) => (
            <Command key={command} text={command} />
          ))}
        </div>
      )}
    </div>
  );
}

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-command">
      <code>{text}</code>
      <Button
        kind="quiet"
        onClick={() =>
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

/** Code as it was sent with an answer, coloured, read-only, with its run. */
export function SentCode({ code }: { code: CodeAnswerValue }) {
  return (
    <div className="code-answer">
      <pre className="code-sent">
        <code>
          {highlightPython(code.source.trimEnd()).map((token, i) => (
            <span key={i} className={`tok-${token.kind}`}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
      {code.run ? <RunOutput run={code.run} /> : <p className="t-caption m-0 text-muted">Not run</p>}
    </div>
  );
}
