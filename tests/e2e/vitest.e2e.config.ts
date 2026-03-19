import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@src': fileURLToPath(new URL('../../src', import.meta.url)),
      '@extension-sdk': fileURLToPath(new URL('../../packages/extension-sdk/src', import.meta.url)),
      '@errors': fileURLToPath(new URL('../../src/errors', import.meta.url)),
      '@modules': fileURLToPath(new URL('../../src/modules', import.meta.url)),
      '@native': fileURLToPath(new URL('../../src/native', import.meta.url)),
      '@server': fileURLToPath(new URL('../../src/server', import.meta.url)),
      '@services': fileURLToPath(new URL('../../src/services', import.meta.url)),
      '@tests': fileURLToPath(new URL('../../tests', import.meta.url)),
      '@internal-types': fileURLToPath(new URL('../../src/types', import.meta.url)),
      '@utils': fileURLToPath(new URL('../../src/utils', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
  },
});
