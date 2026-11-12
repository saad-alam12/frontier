import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Refuse value imports of these folders (type imports are fine: they vanish at build). */
const refuse = (folders, message) => ({ group: folders.flatMap((f) => [`**/${f}/*`, `**/${f}/**`]), allowTypeImports: true, message });
const WORLD_WRITES = { group: ['**/store/worldWrites'], message: 'Only the merger (services/merger.ts) writes nodes and chains.' };
/** One no-restricted-imports rule per folder, tests left free to set up what they check. */
function layers(byFolder) {
  return Object.entries(byFolder).map(([files, patterns]) => ({ files: [files], ignores: ['**/*.test.ts'], rules: { '@typescript-eslint/no-restricted-imports': ['error', { patterns }] } }));
}

export default tseslint.config(
  { ignores: ['node_modules/**', 'out/**', 'dist/**', 'release/**', 'data/**', 'models-cache/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['ui/**/*.{ts,tsx}'],
    languageOptions: { globals: { window: 'readonly', document: 'readonly', navigator: 'readonly' } },
  },
  // The layer rules (design §11.2): imports point inward, and the world layer has one writer.
  ...layers({
    'ui/**/*.{ts,tsx}': [refuse(['backend/store', 'backend/services', 'backend/agents', 'backend/llm', 'backend/settings'], 'The window renders; it reaches the backend over IPC only.')],
    'backend/api/**/*.ts': [refuse(['store'], 'The transport calls services, never the store: a rule the store keeps (clean-up, one writer) lives in a service.')],
    'backend/core/**/*.ts': [refuse(['store', 'services', 'agents', 'llm', 'api', 'ingest', 'settings'], 'core is pure: no store, no model, no IO.'), { group: ['electron', 'node:fs', 'node:fs/*', 'node:child_process', 'node:net', 'node:http', 'node:https'], message: 'core is pure: no IO.' }],
    'backend/agents/**/*.ts': [refuse(['store', 'services', 'api'], 'An agent gets what it needs from its caller and answers through its submit tool.'), WORLD_WRITES],
    'backend/store/**/*.ts': [refuse(['services', 'agents', 'api', 'llm'], 'The store is the innermost layer.')],
    'backend/services/**/*.ts': [refuse(['api'], 'Services do not know the transport.'), WORLD_WRITES],
    'backend/{llm,ingest,settings,render}/**/*.ts': [refuse(['api', 'services'], 'Imports point inward.'), WORLD_WRITES],
  }),
  // the merger is the one module that writes nodes and chains
  { files: ['backend/services/merger.ts'], rules: { '@typescript-eslint/no-restricted-imports': ['error', { patterns: [{ group: ['**/api/*'], allowTypeImports: true, message: 'Services do not know the transport.' }] }] } },
);
