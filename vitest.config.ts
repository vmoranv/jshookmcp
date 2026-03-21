import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const isWindows = process.platform === 'win32';
const vitestPool = isWindows ? 'forks' : 'threads';

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
    // Vitest's thread pool is flaky on Windows in long command chains like
    // `pnpm run lint && pnpm run typecheck && pnpm run test`.
    pool: vitestPool,
    maxWorkers: isWindows ? 2 : undefined,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/types.ts', 'src/types/**'],
      reporter: ['text', 'json', 'html'],
    },
  },
});
