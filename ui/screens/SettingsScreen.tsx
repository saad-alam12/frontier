import { useEffect, useState, type ReactNode } from 'react';
import { call } from '../api';
import type { AppInfo, ConnectionTestResult, Effort, ModelOptions, Role, Settings, SettingsPatch } from '../../backend/api/contract';
import { Screen } from '../components/Shell';
import { Button, Section } from '../components/controls';
import { EraseMap } from '../components/EraseMap';

const ROLE_LABELS: { role: Role; label: string; does: string }[] = [
  { role: 'goalCompiler', label: 'Goal compiler', does: 'Turns a goal into skills and the ideas each needs' },
  { role: 'tutor', label: 'Tutor', does: 'Teaches each step and grades your answers' },
  { role: 'tutorEscalation', label: 'Second opinion', does: 'Explains afresh when a worked example did not help' },
  { role: 'prober', label: 'Prober', does: 'Writes and judges the probe questions' },
  { role: 'planner', label: 'Planner', does: "Picks each session's ideas" },
  { role: 'extractor', label: 'Extractor', does: 'Reads sources into ideas and chains' },
  { role: 'matcher', label: 'Matcher', does: 'Decides which ideas are the same' },
  { role: 'problemGenerator', label: 'Problem generator', does: 'Writes practice problems (with practice)' },
  { role: 'grader', label: 'Grader', does: 'Grades practice (with practice)' },
  { role: 'librarian', label: 'Librarian', does: 'Answers lookups (with lookup)' },
  { role: 'connectionTest', label: 'Connection test', does: 'The test button above' },
];

const EFFORT_LABEL: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
const CUSTOM = '__custom__';

export function SettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [options, setOptions] = useState<ModelOptions | null>(null);

  useEffect(() => {
    void call('settings.get').then(setSettings);
    void call('settings.modelOptions').then(setOptions);
    void call('app.info').then(setInfo);
  }, []);

  if (!settings || !options) return <Screen>{null}</Screen>;

  const update = async (patch: SettingsPatch) => {
    const next = await call('settings.update', patch);
    setSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await call('settings.testConnection'));
    } finally {
      setTesting(false);
    }
  };

  const chooseFolder = async () => {
    const folder = await call('settings.chooseFolder');
    if (folder) await update({ dataFolder: folder });
  };

  return (
    <Screen>
      <div className="flex flex-col gap-[14px]">
        <h1 className="t-display">Settings</h1>
        <p className="t-lead m-0">{saved ? 'Saved' : 'Changes are saved as you make them.'}</p>
      </div>

      <Section title="Model provider" gap={14}>
        <div className="settings-group">
          <SettingRow label="Provider" htmlFor="provider" hint="The Claude login uses the Claude Code login already on this Mac. An API key uses the public API and is billed per call.">
            <select id="provider" className="input" value={settings.provider} onChange={(e) => void update({ provider: e.target.value as Settings['provider'] })}>
              <option value="agentSdk">Claude login (subscription)</option>
              <option value="anthropicApi">Anthropic API key</option>
            </select>
          </SettingRow>
          {settings.provider === 'anthropicApi' && (
            <SettingRow label="API key" htmlFor="api-key">
              <input
                id="api-key"
                className="input"
                type="password"
                value={settings.apiKey}
                onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                onBlur={(e) => void update({ apiKey: e.target.value })}
                placeholder="sk-ant-..."
              />
            </SettingRow>
          )}
          <SettingRow label="Model calls at once" htmlFor="concurrency" hint="Background work never runs more calls than this at the same time. Keep it low on a subscription.">
            <input id="concurrency" className="input is-narrow" type="number" min={1} max={8} value={settings.concurrency} onChange={(e) => void update({ concurrency: Number(e.target.value) || 1 })} />
          </SettingRow>
          <SettingRow
            label="Connection"
            hint={
              testResult
                ? testResult.ok
                  ? `Connected via ${testResult.provider} (${testResult.model}) in ${testResult.attempts} attempt${testResult.attempts === 1 ? '' : 's'}.`
                  : `Failed: ${testResult.error}`
                : 'Sends one short request to check that the model answers.'
            }
            hintError={testResult !== null && !testResult.ok}
          >
            <Button onClick={() => void testConnection()} disabled={testing}>
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
          </SettingRow>
        </div>
      </Section>

      <Section title="Models" gap={14}>
        <p className="m-0 text-[13px] text-muted">Which model does each job, and how hard it thinks. Higher effort is slower and uses more of your plan.</p>
        <ul className="list-card">
          {ROLE_LABELS.map(({ role, label, does }) => (
            <RoleRow key={role} role={role} label={label} does={does} settings={settings} options={options} onChange={(patch) => void update(patch)} />
          ))}
        </ul>
      </Section>

      <Section title="Data" gap={14}>
        <div className="settings-group">
          <SettingRow label="Data folder" hint="Holds the database, the sources you add and exports. Changing it does not move existing data.">
            <Button onClick={() => void chooseFolder()}>Change…</Button>
          </SettingRow>
          <div className="settings-path">
            <code className="truncate font-mono text-[12px] text-secondary" title={settings.dataFolder}>
              {settings.dataFolder}
            </code>
          </div>
        </div>
        {info && <p className="m-0 text-[12px] text-muted">Frontier {info.version}. Settings file: {info.settingsFile}</p>}
      </Section>

      <EraseMap />
    </Screen>
  );
}

/** One row of a settings group: what it is and why on the left, the control on the right. */
function SettingRow({ label, hint, hintError, htmlFor, children }: { label: string; hint?: string; hintError?: boolean; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="flex min-w-0 flex-col gap-[2px]">
        <label className="settings-label" htmlFor={htmlFor}>
          {label}
        </label>
        {hint && <span className={hintError ? 't-small text-danger' : 't-small text-muted'}>{hint}</span>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function RoleRow({
  role,
  label,
  does,
  settings,
  options,
  onChange,
}: {
  role: Role;
  label: string;
  does: string;
  settings: Settings;
  options: ModelOptions;
  onChange: (patch: SettingsPatch) => void;
}) {
  const fallback = options.defaults[role];
  const name = (id: string) => options.models.find((m) => m.id === id)?.name ?? id;
  const model = settings.models[role]?.trim() || fallback.model;
  const known = options.models.find((m) => m.id === model);
  const [custom, setCustom] = useState(known ? '' : model);
  const [editingCustom, setEditingCustom] = useState(!known);
  const efforts = known?.efforts ?? options.efforts;
  const effort = settings.efforts[role] ?? (model === fallback.model ? fallback.effort : 'high');
  const overridden = Boolean(settings.models[role]?.trim()) || settings.efforts[role] !== undefined;
  const setModel = (id: string) => onChange({ models: { [role]: id === fallback.model ? '' : id } });

  return (
    <li className="flex flex-col gap-[10px]">
      <div className="grid grid-cols-[minmax(0,1fr)_180px_140px] items-center gap-[12px]">
        <div className="flex min-w-0 flex-col">
          <span>{label}</span>
          <span className="t-small truncate text-muted">{does}</span>
        </div>
        <select
          className="input"
          aria-label={`${label} model`}
          value={editingCustom ? CUSTOM : model}
          onChange={(e) => {
            if (e.target.value === CUSTOM) setEditingCustom(true);
            else {
              setEditingCustom(false);
              setModel(e.target.value);
            }
          }}
        >
          {options.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
        <select className="input" aria-label={`${label} effort`} value={effort} onChange={(e) => onChange({ efforts: { [role]: e.target.value as Effort } })}>
          {efforts.map((e) => (
            <option key={e} value={e}>
              {EFFORT_LABEL[e]}
            </option>
          ))}
        </select>
      </div>
      {editingCustom && (
        <input
          className="input"
          aria-label={`${label} custom model id`}
          placeholder="Model id, e.g. claude-opus-5"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onBlur={() => custom.trim() && setModel(custom.trim())}
        />
      )}
      {overridden && (
        <div className="t-small flex gap-[12px] text-muted">
          <span>
            Default: {name(fallback.model)}, {EFFORT_LABEL[fallback.effort].toLowerCase()}
          </span>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setEditingCustom(false);
              setCustom('');
              onChange({ models: { [role]: '' }, efforts: { [role]: null } });
            }}
          >
            Use the default
          </button>
        </div>
      )}
    </li>
  );
}
