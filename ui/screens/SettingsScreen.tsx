import { useEffect, useState } from 'react';
import { call } from '../api';
import type { AppInfo, ConnectionTestResult, Role, Settings } from '../../backend/api/contract';
import { Button, Field, Page, inputClass } from '../components/Page';

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

  if (!settings) return <Page title="Settings" />;

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
    <Page title="Settings" subtitle={saved ? 'Saved' : 'Changes are saved as you make them'}>
      <div className="grid max-w-2xl gap-6">
        <section className="rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="mb-3 font-medium">Model provider</h2>
          <div className="grid gap-4">
            <Field label="Provider" hint="The Claude login uses the Claude Code login already on this machine. The API key option uses the public API.">
              <select className={inputClass} value={settings.provider} onChange={(e) => void update({ provider: e.target.value as Settings['provider'] })}>
                <option value="agentSdk">Claude login (subscription)</option>
                <option value="anthropicApi">Anthropic API key</option>
              </select>
            </Field>
            {settings.provider === 'anthropicApi' && (
              <Field label="API key">
                <input
                  className={inputClass}
                  type="password"
                  value={settings.apiKey}
                  onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                  onBlur={(e) => void update({ apiKey: e.target.value })}
                  placeholder="sk-ant-..."
                />
              </Field>
            )}
            <Field label="Parallel model calls" hint="Background work runs at most this many model calls at once. Keep it low on a subscription.">
              <input
                className={inputClass}
                type="number"
                min={1}
                max={8}
                value={settings.concurrency}
                onChange={(e) => void update({ concurrency: Number(e.target.value) || 1 })}
              />
            </Field>
            <div className="flex items-center gap-3">
              <Button kind="primary" onClick={() => void testConnection()} disabled={testing}>
                {testing ? 'Testing…' : 'Test connection'}
              </Button>
              {testResult && (
                <span className={'text-sm ' + (testResult.ok ? 'text-green-700' : 'text-red-700')}>
                  {testResult.ok
                    ? `Connected via ${testResult.provider} (${testResult.model}): "${testResult.reply?.greeting}" in ${testResult.attempts} attempt${testResult.attempts === 1 ? '' : 's'}`
                    : `Failed: ${testResult.error}`}
                </span>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="mb-1 font-medium">Model per role</h2>
          <p className="mb-3 text-xs text-stone-500">Leave a field empty to use the default. Strong model for teaching, generating and grading; a cheaper model is fine for matching and extraction.</p>
          <div className="grid grid-cols-2 gap-3">
            {ROLE_LABELS.map(({ role, label }) => (
              <Field key={role} label={label}>
                <input
                  className={inputClass}
                  value={settings.models[role] ?? ''}
                  placeholder="default"
                  onChange={(e) => setSettings({ ...settings, models: { ...settings.models, [role]: e.target.value } })}
                  onBlur={(e) => void update({ models: { [role]: e.target.value } as Settings['models'] })}
                />
              </Field>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="mb-3 font-medium">Data folder</h2>
          <div className="flex items-center gap-3">
            <code className="flex-1 truncate rounded bg-stone-100 px-2 py-1 text-xs">{settings.dataFolder}</code>
            <Button onClick={() => void chooseFolder()}>Change</Button>
          </div>
          <p className="mt-2 text-xs text-stone-500">Holds the database, the sources you add and exports. Changing it does not move existing data.</p>
          {info && <p className="mt-2 text-xs text-stone-400">Frontier {info.version}. Settings file: {info.settingsFile}</p>}
        </section>
      </div>
    </Page>
  );
}
