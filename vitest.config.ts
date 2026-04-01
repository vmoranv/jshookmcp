import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@src': fileURLToPath(new URL('./src', import.meta.url)),
      '@extension-sdk': fileURLToPath(new URL('./packages/extension-sdk/src', import.meta.url)),
      '@errors': fileURLToPath(new URL('./src/errors', import.meta.url)),
      '@modules': fileURLToPath(new URL('./src/modules', import.meta.url)),
      '@native': fileURLToPath(new URL('./src/native', import.meta.url)),
      '@server': fileURLToPath(new URL('./src/server', import.meta.url)),
      '@services': fileURLToPath(new URL('./src/services', import.meta.url)),
      '@tests': fileURLToPath(new URL('./tests', import.meta.url)),
      '@internal-types': fileURLToPath(new URL('./src/types', import.meta.url)),
      '@utils': fileURLToPath(new URL('./src/utils', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    setupFiles: ['tests/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
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
      ],
      reporter: ['text', 'json', 'html', 'text-summary'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 85,
        statements: 95,
      },
    },
  },
});
