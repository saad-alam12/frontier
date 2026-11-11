/**
 * Live check of what a model call can see with the Claude login on this machine: `npm run live:tools`.
 * It makes one small call (the connection test) through the Agent SDK provider, exactly as the app
 * does, and prints the tools and MCP servers the SDK reports for that call. Only Frontier's own
 * `mcp__frontier__*` tools should be there: calls read text from sources the learner did not write,
 * so they must not reach connectors on the Claude account (mail, drive, GitHub), files or the web.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runConnectionTest } from '../backend/agents/connectionTest';
import { AgentSdkProvider } from '../backend/llm/AgentSdkProvider';
import { SettingsSchema, modelChoice } from '../backend/settings/schema';

const settings = SettingsSchema.parse({});
let seen: { tools: string[]; mcpServers: { name: string; status: string }[]; permissionMode: string } | null = null;
const provider = new AgentSdkProvider({
  modelForRole: (role) => modelChoice(settings, role),
  cwd: mkdtempSync(join(tmpdir(), 'frontier-live-')),
  onInit: (info) => (seen = info),
});

const result = await runConnectionTest(provider);
console.log(`Connection: ${result.ok ? 'ok' : 'failed'}`);
if (!seen) {
  console.log('The SDK reported no tool list for the call. Send this output to the build session.');
  process.exit(1);
}
const info = seen as { tools: string[]; mcpServers: { name: string; status: string }[]; permissionMode: string };
const foreignTools = info.tools.filter((name) => !name.startsWith('mcp__frontier__'));
const foreignServers = info.mcpServers.filter((server) => server.name !== 'frontier');
console.log(`Permission mode: ${info.permissionMode}`);
console.log(`Tools the model can see (${info.tools.length}): ${info.tools.join(', ') || 'none'}`);
console.log(`MCP servers (${info.mcpServers.length}): ${info.mcpServers.map((s) => `${s.name} (${s.status})`).join(', ') || 'none'}`);
if (foreignTools.length || foreignServers.length) {
  console.log(`\nNOT CLEAN. Beyond Frontier's own tools the call can see: ${[...foreignTools, ...foreignServers.map((s) => `server ${s.name}`)].join(', ')}`);
  process.exit(1);
}
console.log("\nClean: the call sees only Frontier's own tools.");
process.exit(result.ok ? 0 : 1);
