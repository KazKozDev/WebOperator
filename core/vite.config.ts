import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import path from 'node:path';
import manifest from './manifest.config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
  plugins: [react(), crx({ manifest })],
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      input: {
        sidepanel: 'src/sidepanel/index.html',
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'coverage',
      // Only the code the unit suites actually exercise. The side panel,
      // content script and service worker are covered by browser evals, not
      // by Vitest, so counting them would report a number nobody can act on.
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts', 'src/lib/types.ts'],
      // A ratchet, not a target: these sit just under the numbers the suite
      // actually reaches today (lines 31%, statements 29%, functions 38%,
      // branches 24%), so a change that removes coverage fails the gate.
      // Raise them as tests land — never lower them to make a build pass.
      thresholds: {
        lines: 30,
        statements: 28,
        functions: 37,
        branches: 23,
      },
    },
  },
});
