import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Disable parallel test file execution to prevent truncate conflicts on shared TEST_DATABASE_URL
    fileParallelism: false,
    // Run server tests serially - single worker to avoid DB lock contention
    maxWorkers: 1,
    // No test reaches GitHub: background update checks are off (config.checkUpdates),
    // and the update tests pass their own feed and fetch to buildApp.
    env: { BUKMARK_UPDATE_FEED: 'off' },
  },
});
