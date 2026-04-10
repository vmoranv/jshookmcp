import { cpus } from 'node:os';
import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Project root (directory containing package.json)
const root = resolve(dirname(fileURLToPath(import.meta.url)));

const detectedCpuCount = Math.max(1, cpus().length);
const requestedMaxWorkers = Number.parseInt(process.env.VITEST_MAX_WORKERS ?? '', 10);
const configuredMaxWorkers =
  Number.isFinite(requestedMaxWorkers) && requestedMaxWorkers > 0
    ? Math.min(requestedMaxWorkers, detectedCpuCount)
    : undefined;

// Coverage reporter configuration based on environment
const coverageReporter =
  process.env.COVERAGE_FULL === 'true'
    ? ['text', 'json', 'html', 'text-summary']
    : ['text-summary'];

// Coverage exclusion patterns (shared across all projects)
const coverageExclude = [
  'src/**/*.d.ts',
  'src/**/types.ts',
  'src/types/**',
  'src/*/**/index.ts',
  'src/**/manifest.ts',
  'src/**/*.types.ts',
  // Pure re-export handler files (zero logic, just re-export from impl)
  'src/server/domains/analysis/handlers.ts',
  'src/server/domains/browser/handlers.ts',
  'src/server/domains/encoding/handlers.ts',
  'src/server/domains/graphql/handlers.ts',
  'src/server/domains/network/handlers.ts',
  'src/server/domains/process/handlers.ts',
  'src/server/domains/sourcemap/handlers.ts',
  'src/server/domains/streaming/handlers.ts',
  'src/server/domains/transform/handlers.ts',
  'src/server/domains/workflow/handlers.ts',
  // Pure re-export/type-only barrel files
  'src/server/domains/shared/modules.ts',
  'src/server/domains/shared/registry.ts',
  'src/server/registry/contracts.ts',
  'src/server/plugins/pluginContract.ts',
  // Definition-only files (0% coverage, contain only Tool[] arrays)
  'src/server/domains/*/definitions.ts',
];

export default defineConfig({
  resolve: {
    alias: [
      // Explicit .ts extensions so require() can find modules without extension auto-append
      {
        find: '@server/domains/canvas/adapters/cocos-adapter',
        replacement: resolve(root, 'src/server/domains/canvas/adapters/cocos-adapter.ts'),
      },
      {
        find: '@server/domains/canvas/adapters/pixi-adapter',
        replacement: resolve(root, 'src/server/domains/canvas/adapters/pixi-adapter.ts'),
      },
      {
        find: '@server/domains/canvas/adapters/phaser-adapter',
        replacement: resolve(root, 'src/server/domains/canvas/adapters/phaser-adapter.ts'),
      },
      {
        find: '@server/domains/canvas/adapters',
        replacement: resolve(root, 'src/server/domains/canvas/adapters'),
      },
      { find: '@server', replacement: resolve(root, 'src/server') },
      { find: '@src', replacement: resolve(root, 'src') },
      { find: '@modules', replacement: resolve(root, 'src/modules') },
      { find: '@native', replacement: resolve(root, 'src/native') },
      { find: '@utils', replacement: resolve(root, 'src/utils') },
      { find: '@services', replacement: resolve(root, 'src/services') },
      { find: '@errors', replacement: resolve(root, 'src/errors') },
      { find: '@internal-types', replacement: resolve(root, 'src/types') },
      { find: '@extension-sdk', replacement: resolve(root, 'packages/extension-sdk/src') },
      {
        find: '@jshookmcp/extension-sdk',
        replacement: resolve(root, 'packages/extension-sdk/src'),
      },
      { find: '@tests', replacement: resolve(root, 'tests') },
    ],
    // Note: tsconfigPaths is intentionally omitted. The explicit resolve.alias
    // entries above handle all path aliases correctly. tsconfigPaths can mangle
    // aliases into incorrect relative paths when dynamic require() is used in
    // tests (e.g. the canvas multi-engine adapter tests), causing ENOENT errors.
    // Additionally, explicit .ts extensions are needed for require() resolution.
  },
  test: {
    // ── Shared defaults (inherited by projects via extends: true) ──
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    ...(configuredMaxWorkers ? { maxWorkers: configuredMaxWorkers } : {}),
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: coverageExclude,
      reporter: coverageReporter,
      thresholds: {
        // Coverage gate is calibrated to the current repo baseline so push hooks
        // catch regressions without blocking on long-standing uncovered surfaces.
        lines: 88,
        functions: 88,
        branches: 79,
        statements: 88,
      },
    },

    // ── Projects for optimized parallel execution ──
    // Run all:     vitest run
    // Run single:  vitest run --project pure
    projects: [
      {
        extends: true,
        test: {
          name: 'pure',
          pool: 'forks', // Use forks because pure tests might load better-sqlite3 via cache utils
          include: [
            'tests/utils/**/*.test.ts',
            'tests/errors/**/*.test.ts',
            'tests/contracts/**/*.test.ts',
            'tests/cli/**/*.test.ts',
            'tests/packages/**/*.test.ts',
            'tests/constants.test.ts',
          ],
          exclude: ['tests/e2e/**'],
          setupFiles: ['tests/setup.light.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          pool: 'forks', // Use forks for better-sqlite3 compatibility
          include: [
            'tests/server/**/*.test.ts',
            'tests/modules/**/*.test.ts',
            'tests/services/**/*.test.ts',
            'tests/index.test.ts',
            'tests/simple-stub-test.test.ts',
          ],
          exclude: ['tests/e2e/**', 'tests/modules/process/**/*.test.ts'],
          setupFiles: ['tests/setup.registry.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'native',
          pool: 'forks', // FFI (koffi) is NOT thread-safe — must use process isolation
          include: ['tests/native/**/*.test.ts', 'tests/modules/process/**/*.test.ts'],
          exclude: ['tests/e2e/**'],
          setupFiles: ['tests/setup.registry.ts'],
        },
      },
    ],
  },
});
