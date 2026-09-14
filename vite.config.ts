import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600, // phaser is a single large vendor chunk
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/phaser') ? 'phaser' : undefined),
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    /**
     * Vitest's 5s default is far too tight for this suite and always was.
     *
     * A dozen sim tests run thousands of ticks on a populated floor and land
     * between 4 and 6 seconds, so they passed alone and failed in a full run
     * purely on CPU contention between parallel workers — a red suite that
     * reads as a regression and sends you hunting a phantom bug. P17's
     * catalogue measurements made it acute by adding real work: the failures
     * went from 1-3 to 8, and campaigns.test.ts began blowing even its own
     * explicit 120s.
     *
     * Every one of those failures reported "Test timed out", never an
     * assertion. This raises the floor for the whole suite; the genuinely
     * long-running measurement tests still declare their own larger budgets.
     */
    testTimeout: 30_000,
  },
});
