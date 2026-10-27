/**
 * Compare two model/effort settings for one role on the same source, side by side.
 * Run deliberately: `npm run live:compare -- <file> --a <model>:<effort> --b <model>:<effort> [--role extractor|matcher]`.
 * Each side ingests the file into its own temporary database (the owner's database is never touched);
 * every other role keeps its default. Prints node and chain counts, a sample of each, tokens and cost.
 */
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createProvider } from '../backend/llm';
import type { CompleteRequest, CompleteResult, LlmProvider, Role } from '../backend/llm/provider';
import { TransformersEmbedder } from '../backend/ingest/embedder';
import { EFFORTS, SettingsSchema } from '../backend/settings/schema';
import type { Effort } from '../backend/settings/schema';
import { IngestionService } from '../backend/services/ingestion';
import { openDatabase } from '../backend/store/db';
import { listChains, listNodes } from '../backend/store/world';

const COMPARABLE_ROLES: Role[] = ['extractor', 'matcher'];
const SAMPLE = 12;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function parseSide(value: string | undefined, label: string): { model: string; effort: Effort } {
  const [model, effort] = (value ?? '').split(':');
  if (!model || !effort || !(EFFORTS as readonly string[]).includes(effort)) {
    console.error(`--${label} must look like claude-haiku-5-5:max (effort one of ${EFFORTS.join(', ')})`);
    process.exit(2);
  }
  return { model, effort: effort as Effort };
}

/** Adds up usage over every call of one role. */
class MeteredProvider implements LlmProvider {
  readonly name: string;
  usage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, costKnown: true };

  constructor(
    private readonly inner: LlmProvider,
    private readonly role: Role,
  ) {
    this.name = inner.name;
  }

  async complete<T>(req: CompleteRequest<T>): Promise<CompleteResult<T>> {
    const result = await this.inner.complete(req);
    if (req.role === this.role) {
      this.usage.calls += 1;
      this.usage.inputTokens += result.usage.inputTokens;
      this.usage.outputTokens += result.usage.outputTokens;
      if (result.usage.costUsd === undefined) this.usage.costKnown = false;
      else this.usage.costUsd += result.usage.costUsd;
    }
    return result;
  }
}

async function runSide(file: string, role: Role, side: { model: string; effort: Effort }) {
  const dir = mkdtempSync(join(tmpdir(), 'frontier-compare-'));
  const settings = SettingsSchema.parse({
    provider: process.env['FRONTIER_PROVIDER'] ?? 'agentSdk',
    apiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
    models: { [role]: side.model },
    efforts: { [role]: side.effort },
  });
  const provider = new MeteredProvider(createProvider(settings, join(dir, 'agent')), role);
  const db = openDatabase(join(dir, 'frontier.db'));
  const started = Date.now();
  const service = new IngestionService({
    db,
    provider,
    // reuse the app's downloaded embedding model when it exists
    embedder: new TransformersEmbedder(join(homedir(), 'Frontier', 'models-cache')),
    sourcesDir: join(dir, 'sources'),
  });
  const { source } = await service.addFile(resolve(file));
  const done = await service.runSource(source.id);
  const nodes = listNodes(db);
  const names = new Map(nodes.map((n) => [n.id, n.name]));
  const chains = listChains(db).map((c) => `${c.premises.map((p) => names.get(p) ?? p).join(' + ')} ⟹ ${names.get(c.conclusion) ?? c.conclusion}`);
  const result = { label: `${side.model}:${side.effort}`, status: done.status, seconds: Math.round((Date.now() - started) / 1000), nodes, chains, usage: provider.usage, dbPath: join(dir, 'frontier.db') };
  db.close();
  return result;
}

const file = process.argv[2];
const role = (arg('role') ?? 'extractor') as Role;
if (!file || file.startsWith('--')) {
  console.error('usage: npm run live:compare -- <file> --a <model>:<effort> --b <model>:<effort> [--role extractor|matcher]');
  process.exit(2);
}
if (!COMPARABLE_ROLES.includes(role)) {
  console.error(`--role ${role} is not comparable yet: only ${COMPARABLE_ROLES.join(' and ')} run during ingestion. Other roles need recorded prompts (not built yet).`);
  process.exit(2);
}
const a = parseSide(arg('a'), 'a');
const b = parseSide(arg('b'), 'b');

console.log(`Comparing ${role} on ${file}: A = ${a.model}:${a.effort}, B = ${b.model}:${b.effort}. The two sides run one after the other.\n`);
const results = [await runSide(file, role, a), await runSide(file, role, b)];

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
const col = 48;
const row = (label: string, values: string[]) => console.log(`${pad(label, 18)}${values.map((v) => pad(v, col)).join('')}`);
row('', results.map((r, i) => `${i === 0 ? 'A' : 'B'}  ${r.label}`));
row('status', results.map((r) => `${r.status}, ${r.seconds} s`));
row('nodes', results.map((r) => String(r.nodes.length)));
row('chains', results.map((r) => String(r.chains.length)));
row(`${role} calls`, results.map((r) => String(r.usage.calls)));
row('input tokens', results.map((r) => r.usage.inputTokens.toLocaleString('en')));
row('output tokens', results.map((r) => r.usage.outputTokens.toLocaleString('en')));
row('cost (est.)', results.map((r) => (r.usage.costKnown ? `$${r.usage.costUsd.toFixed(3)}` : 'not reported by this provider')));
console.log('');
for (let i = 0; i < SAMPLE; i += 1) row(i === 0 ? 'sample nodes' : '', results.map((r) => (r.nodes[i] ? `${r.nodes[i]?.kind}: ${r.nodes[i]?.name}` : '')));
console.log('');
for (let i = 0; i < SAMPLE; i += 1) row(i === 0 ? 'sample chains' : '', results.map((r) => r.chains[i] ?? ''));
console.log(`\nFull results stay in ${results.map((r) => r.dbPath).join(' and ')} (open with sqlite3 to inspect).`);
