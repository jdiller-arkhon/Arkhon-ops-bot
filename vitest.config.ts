import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Resolve workspace packages to their TypeScript sources (see "development" export condition).
    conditions: ['development'],
  },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'bots/*/test/**/*.test.ts',
      'deploy/*/test/**/*.test.ts',
    ],
    environment: 'node',
  },
});
