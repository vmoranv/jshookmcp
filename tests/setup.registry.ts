// Full per-worker setup: initializes registry + PageController mock.
// Used by "server" and "native" projects that depend on registry or page evaluate wrappers.
import { beforeAll, afterEach, vi } from 'vitest';
import { initRegistry } from '@server/registry/index';

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

afterEach(async () => {
  if (global.gc) {
    global.gc();
  }
});
