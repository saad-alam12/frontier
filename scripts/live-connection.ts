/**
 * Live check of the model connection. Run deliberately: `npm run live:connection`.
 * Uses the Claude login on this machine by default; set FRONTIER_PROVIDER=anthropicApi and
 * ANTHROPIC_API_KEY to test the API provider instead.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProvider } from '../backend/llm';
import { SettingsSchema } from '../backend/settings/schema';
import { runConnectionTest } from '../backend/agents/connectionTest';

const settings = SettingsSchema.parse({
  provider: process.env['FRONTIER_PROVIDER'] ?? 'agentSdk',
  apiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
});
const provider = createProvider(settings, mkdtempSync(join(tmpdir(), 'frontier-live-')));
const result = await runConnectionTest(provider);
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
