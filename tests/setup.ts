// Per-worker setup: initialise the tool registry before any test in this worker.
import { beforeAll, afterEach, vi } from 'vitest';
import { initRegistry } from '@server/registry/index';

// Set test environment variables
process.env.ENABLE_INJECTION_TOOLS = 'true';
process.env.NODE_ENV = 'test';

// ── Global mock for PageController evaluate wrappers ─────────────────
// In production, evaluateWithTimeout calls checkPageCDPHealth(page) which
// requires page.createCDPSession(). Test mock pages don't have this method,
// causing AbortError / timeout. We mock these wrappers to pass through
// directly to page.evaluate / page.evaluateOnNewDocument.
vi.mock('@modules/collector/PageController', async (importOriginal) => {
  const original = await importOriginal<typeof import('@modules/collector/PageController')>();
  return {
    ...original,
    evaluateWithTimeout: async (page: any, pageFunction: any, ...args: any[]) => {
      return page.evaluate(pageFunction, ...args);
    },
    evaluateOnNewDocumentWithTimeout: async (page: any, pageFunction: any, ...args: any[]) => {
      return page.evaluateOnNewDocument(pageFunction, ...args);
    },
  };
});

beforeAll(async () => {
  await initRegistry();
});

// Cleanup after each test to prevent resource leaks
afterEach(async () => {
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
});
