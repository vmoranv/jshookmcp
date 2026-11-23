import { defineConfig } from 'tsdown';

const analyzeEnabled = process.env.BUNDLE_ANALYZE === '1';

export default defineConfig(async () => ({
  entry: [
    'src/index.ts',
    'src/server/plugin-api.ts',
    'src/server/fleet-api.ts',
    // Unidbg JVM-invocation worker — spawned as a standalone subprocess by
    // UnidbgRunner via @utils/subprocess-worker (JSONL over stdio).
    'src/modules/binary-instrument/unidbg-worker.ts',
  ],
  format: 'esm' as const,
  clean: true,
  dts: false,
  minify: true,
  plugins: analyzeEnabled
    ? [
        (await import('rollup-plugin-visualizer')).visualizer({
          filename: './stats.html',
          open: false,
          gzipSize: true,
          brotliSize: true,
        }),
      ]
    : [],
  deps: {
    neverBundle: [
      'koffi',
      'better-sqlite3',
      'quickjs-emscripten',
      '@devicefarmer/adbkit',
      'camoufox-js',
      'playwright-core',
      'webcrack',
      'rebrowser-puppeteer-core',
      '@modelcontextprotocol/sdk',
      'jsdom',
      'mockttp',
      '@babel/generator',
      '@babel/parser',
      '@babel/traverse',
      '@babel/types',
      'fingerprint-generator',
      'fingerprint-injector',
      'z3-solver',
    ],
  },
}));
