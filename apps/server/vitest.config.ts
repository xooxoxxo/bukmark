import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Disable parallel test file execution to prevent truncate conflicts on shared TEST_DATABASE_URL
    fileParallelism: false,
  },
});
