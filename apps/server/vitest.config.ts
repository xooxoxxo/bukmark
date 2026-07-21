import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Disable parallel test file execution to prevent truncate conflicts on shared TEST_DATABASE_URL
    fileParallelism: false,
    // Run server tests serially - single worker to avoid DB lock contention
    maxWorkers: 1,
  },
});
