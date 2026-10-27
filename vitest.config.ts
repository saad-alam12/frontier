import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['backend/**/*.test.ts', 'ui/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
});
