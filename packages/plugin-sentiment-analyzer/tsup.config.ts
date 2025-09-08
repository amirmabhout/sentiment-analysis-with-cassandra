import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false, // Temporarily disable TypeScript declarations to get build working
  clean: true,
  sourcemap: true,
  splitting: false,
  minify: false,
  external: ['@elizaos/core'],
});
