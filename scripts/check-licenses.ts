/**
 * Check the licence of every package the app ships (CLAUDE.md, "Licensing rules"): permissive
 * licences only. `npm run check:licenses` reads package-lock.json for the packages that are not
 * development-only and each package's own package.json for its licence. It fails on any licence
 * outside the list below, and on a package that states none.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Permissive licences: use, change, sell, no duty to publish your own code. */
const ALLOWED = new Set(['MIT', 'MIT-0', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'BlueOak-1.0.0', 'CC0-1.0', 'Unlicense', 'Zlib', 'Python-2.0', 'CC-BY-4.0', 'Unicode-3.0', 'Unicode-DFS-2016', 'OFL-1.1']);
/** The one allowed dependency that is not open source (CLAUDE.md), isolated in backend/llm/AgentSdkProvider. */
const EXCEPTIONS = new Set(['@anthropic-ai/claude-agent-sdk']);
/** Platform builds of that same SDK, which npm lists as packages of their own. */
const EXCEPTION_PREFIXES = ['@anthropic-ai/claude-agent-sdk-'];

interface LockPackage {
  dev?: boolean;
  license?: string;
  resolved?: string;
}

const root = process.cwd();
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as { packages: Record<string, LockPackage> };

/** True when an SPDX expression is satisfied by allowed licences: every part of an AND, any part of an OR. */
export function allowed(expression: string): boolean {
  const text = expression.trim().replace(/^\((.*)\)$/, '$1');
  if (/ OR /i.test(text)) return text.split(/ OR /i).some(allowed);
  if (/ AND /i.test(text)) return text.split(/ AND /i).every(allowed);
  return ALLOWED.has(text.replace(/^\(|\)$/g, '').trim());
}

const problems: string[] = [];
let checked = 0;
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path.startsWith('node_modules/') || entry.dev) continue;
  const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  if (EXCEPTIONS.has(name) || EXCEPTION_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
  // a package from this repository (vendor/) is the project's own code, not a dependency
  if (entry.resolved?.startsWith('file:')) continue;
  const manifest = join(root, path, 'package.json');
  // an optional package for another platform is not installed here; the lock file states its licence
  const stated = existsSync(manifest) ? (JSON.parse(readFileSync(manifest, 'utf8')) as { license?: unknown; licenses?: { type?: string }[] }) : { license: entry.license };
  const license = typeof stated.license === 'string' ? stated.license : (stated.licenses ?? []).map((l) => l.type).filter(Boolean).join(' OR ');
  checked += 1;
  if (!license) problems.push(`${name}: states no licence`);
  else if (!allowed(license)) problems.push(`${name}: ${license}`);
}

if (problems.length) {
  console.error(`Licences outside the allowed list (${problems.length}):\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`${checked} shipped packages checked: all permissive.`);
