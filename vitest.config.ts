import { cpus } from 'node:os';
import { defineConfig } from 'vitest/config';

// Worker thread count: leave 2 cores for OS + IDE
const maxWorkers = Math.max(2, cpus().length - 2);

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
    tsconfigPaths: true,
  },
  test: {
    // ── Shared defaults (inherited by projects via extends: true) ──
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'threads',
    maxWorkers,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: coverageExclude,
      reporter: coverageReporter,
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 85,
        statements: 95,
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
          pool: 'threads', // No native deps — safe for Worker Threads
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
          pool: 'threads', // Registry-dependent but no native FFI — threads OK
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
