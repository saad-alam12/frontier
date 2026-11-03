/**
 * Live ingestion of a real file with the real model and the local embedding model.
 * Run deliberately: `npm run live:ingest -- path/to/lecture.pdf [path/to/frontier.db]`.
 * Downloads the embedding model into ./models-cache on first use.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createProvider } from '../backend/llm';
import { TransformersEmbedder } from '../backend/ingest/embedder';
import { SettingsSchema } from '../backend/settings/schema';
import { IngestionService } from '../backend/services/ingestion';
import { deltaForSource } from '../backend/services/library';
import { openDatabase } from '../backend/store/db';
import { coveredNodeIds } from '../backend/store/sources';
import { getNodes, listChains, countNodes } from '../backend/store/world';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run live:ingest -- <file> [db path]');
  process.exit(2);
}
const dbPath = process.argv[3] ?? join(mkdtempSync(join(tmpdir(), 'frontier-live-')), 'frontier.db');
const settings = SettingsSchema.parse({ provider: process.env['FRONTIER_PROVIDER'] ?? 'agentSdk', apiKey: process.env['ANTHROPIC_API_KEY'] ?? '' });
const db = openDatabase(dbPath);
const service = new IngestionService({
  db,
  provider: createProvider(settings, mkdtempSync(join(tmpdir(), 'frontier-agent-'))),
  embedder: new TransformersEmbedder(resolve('models-cache')),
  sourcesDir: join(dbPath, '..', 'sources'),
  onProgress: (p) => console.log(`[${p.status}] ${p.chunksDone}/${p.chunkCount}${p.message ? ` ${p.message}` : ''}`),
});

const { source, existed } = await service.addFile(resolve(file));
console.log(`${existed ? 'already added' : 'added'}: ${source.title} (${source.chunkCount} ${source.chunkCount === 1 ? 'part' : 'parts'}) → ${dbPath}`);
const started = Date.now();
await service.runSource(source.id);
console.log(`read in ${Math.round((Date.now() - started) / 1000)} s`);
const ideas = [...getNodes(db, coveredNodeIds(db, source.id)).values()];
console.log(`${ideas.length} ideas from this source:`);
for (const n of ideas) console.log(`- ${n.name} (${n.sources.find((r) => r.sourceId === source.id)?.locator ?? ''}): ${n.statement}`);
console.log(`world layer: ${countNodes(db)} nodes, ${listChains(db).length} chains`);
console.log(deltaForSource(db, source.id).sentence);
db.close();
