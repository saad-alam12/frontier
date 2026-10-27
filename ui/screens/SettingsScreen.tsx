import { useEffect, useState } from 'react';
import { call } from '../api';
import type { AppInfo, ConnectionTestResult, Role, Settings } from '../../backend/api/contract';
import { Screen } from '../components/Shell';
import { Button, Field, Notice, Section } from '../components/controls';

const ROLE_LABELS: { role: Role; label: string }[] = [
  { role: 'tutor', label: 'Tutor' },
  { role: 'goalCompiler', label: 'Goal compiler' },
  { role: 'prober', label: 'Prober' },
  { role: 'planner', label: 'Planner' },
  { role: 'extractor', label: 'Extractor' },
  { role: 'matcher', label: 'Matcher' },
  { role: 'problemGenerator', label: 'Problem generator' },
  { role: 'grader', label: 'Grader' },
  { role: 'librarian', label: 'Librarian' },
  { role: 'connectionTest', label: 'Connection test' },
];

export function SettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void call('settings.get').then(setSettings);
    void call('app.info').then(setInfo);
  }, []);

  if (!settings) return <Screen>{null}</Screen>;

  const update = async (patch: Partial<Settings>) => {
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
        <p className="m-0 text-[15px] text-secondary">{saved ? 'Saved' : 'Changes are saved as you make them.'}</p>
      </div>

      <Section title="Model provider" gap={22}>
        <Field label="Provider" htmlFor="provider" hint="The Claude login uses the Claude Code login already on this machine. The API key option uses the public API.">
          <select id="provider" className="input" value={settings.provider} onChange={(e) => void update({ provider: e.target.value as Settings['provider'] })}>
            <option value="agentSdk">Claude login (subscription)</option>
            <option value="anthropicApi">Anthropic API key</option>
          </select>
        </Field>
        {settings.provider === 'anthropicApi' && (
          <Field label="API key" htmlFor="api-key">
            <input
              id="api-key"
              className="input"
              type="password"
              value={settings.apiKey}
              onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
              onBlur={(e) => void update({ apiKey: e.target.value })}
              placeholder="sk-ant-..."
            />
          </Field>
        )}
        <Field label="Parallel model calls" htmlFor="concurrency" hint="Background work runs at most this many model calls at once. Keep it low on a subscription.">
          <input id="concurrency" className="input" type="number" min={1} max={8} value={settings.concurrency} onChange={(e) => void update({ concurrency: Number(e.target.value) || 1 })} />
        </Field>
        <div className="button-row">
          <Button kind="primary" onClick={() => void testConnection()} disabled={testing}>
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          {testResult && (
            <Notice error={!testResult.ok}>
              {testResult.ok
                ? `Connected via ${testResult.provider} (${testResult.model}) in ${testResult.attempts} attempt${testResult.attempts === 1 ? '' : 's'}.`
                : `Failed: ${testResult.error}`}
            </Notice>
          )}
        </div>
      </Section>

      <Section title="Model per role" gap={22}>
        <p className="m-0 text-[13px] text-muted">Leave a field empty to use the default.</p>
        <div className="grid grid-cols-2 gap-x-[16px] gap-y-[22px]">
          {ROLE_LABELS.map(({ role, label }) => (
            <Field key={role} label={label} htmlFor={`model-${role}`}>
              <input
                id={`model-${role}`}
                className="input"
                value={settings.models[role] ?? ''}
                placeholder="default"
                onChange={(e) => setSettings({ ...settings, models: { ...settings.models, [role]: e.target.value } })}
                onBlur={(e) => void update({ models: { [role]: e.target.value } as Settings['models'] })}
              />
            </Field>
          ))}
        </div>
      </Section>

      <Section title="Data folder" gap={14}>
        <div className="flex items-center gap-[12px]">
          <code className="input flex min-w-0 flex-1 items-center truncate font-mono text-[13px] text-soft">{settings.dataFolder}</code>
          <Button onClick={() => void chooseFolder()}>Change</Button>
        </div>
        <p className="m-0 text-[13px] text-muted">Holds the database, the sources you add and exports. Changing it does not move existing data.</p>
        {info && <p className="m-0 text-[12px] text-muted">Frontier {info.version}. Settings file: {info.settingsFile}</p>}
      </Section>
    </Screen>
  );
}
