import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  // Server tests: must run serially due to shared TEST_DATABASE_URL
  {
    test: {
      include: ['apps/server/**/*.test.ts'],
      fileParallelism: false,
    },
  },
  // Other packages: can run in parallel
  {
    test: {
      include: ['apps/cli/**/*.test.ts', 'packages/shared/**/*.test.ts'],
      fileParallelism: true,
    },
  },
]);
