import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import path from 'node:path';
import fs from 'node:fs';
import manifest from './manifest.config.ts';

/**
 * Ships ONNX Runtime's WebAssembly build with the extension.
 *
 * transformers.js otherwise points ONNX Runtime at jsdelivr and fetches the runtime at first use.
 * That is remote code — which the Chrome Web Store forbids outright, and which fails anyway on a
 * machine that cannot reach the CDN. Copying it into the package makes the classifier's one
 * dependency local; only the model weights are still fetched, and those are data.
 *
 * The plain build is the pair transformers.js itself selects on Safari. The asyncify pair it
 * prefers elsewhere is nearly twice the size and buys nothing for a model this small.
 */
function ortRuntime() {
  const files = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];
  return {
    name: 'ort-runtime',
    apply: 'build' as const,
    /**
     * ONNX Runtime references its wasm through `new URL(..., import.meta.url)`, so the bundler
     * emits a second copy — 23 MB of the asyncify build the classifier never loads, since
     * hf-classifier sets wasmPaths to the files below before the first call. Dropping it keeps
     * the packaged extension at one runtime instead of two.
     */
    generateBundle(_options: unknown, bundle: Record<string, unknown>) {
      for (const fileName of Object.keys(bundle)) {
        if (/ort-wasm.*\.wasm$/.test(fileName)) delete bundle[fileName];
      }
    },
    closeBundle() {
      const from = path.resolve(import.meta.dirname, 'node_modules/onnxruntime-web/dist');
      const to = path.resolve(import.meta.dirname, 'dist/ort');
      fs.mkdirSync(to, { recursive: true });
      for (const file of files) fs.copyFileSync(path.join(from, file), path.join(to, file));
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
  plugins: [react(), crx({ manifest }), ortRuntime()],
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
