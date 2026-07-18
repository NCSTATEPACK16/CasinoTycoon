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
  },
});
