import { defineConfig } from 'tsdown';

const analyzeEnabled = process.env.BUNDLE_ANALYZE === '1';

export default defineConfig(async () => ({
  entry: ['src/index.ts', 'src/server/plugin-api.ts'],
  format: 'esm',
  clean: true,
  dts: true,
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
    ],
  },
  onSuccess: 'node scripts/copy-native-scripts.mjs && node scripts/fix-bin-permissions.mjs',
}));
