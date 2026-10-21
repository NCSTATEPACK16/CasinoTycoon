import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  worker: { format: 'es' },
  // Recast ships its WASM inside the package; pre-bundling breaks its loader.
  optimizeDeps: { exclude: ['@recast-navigation/core', '@recast-navigation/wasm'] },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Same reasoning as v1: heavy sim tests time out under parallel load, not on assertions.
    testTimeout: 30_000,
  },
});
