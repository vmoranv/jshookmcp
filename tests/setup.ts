// Per-worker setup: initialise the tool registry before any test in this worker.
import { beforeAll, afterEach, vi } from 'vitest';
import { initRegistry } from '@server/registry/index';

// Set test environment variables
process.env.NODE_ENV = 'test';

if (typeof globalThis.navigator === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {
      userAgent: `Node.js ${process.versions.node}`,
      platform:
        process.platform === 'win32'
          ? 'Win32'
          : process.platform === 'darwin'
            ? 'MacIntel'
            : 'Linux x86_64',
      language: 'en-US',
      languages: ['en-US', 'en'],
      hardwareConcurrency: 8,
    },
  });
}

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
    // Coverage wrappers for PerformanceMonitor split files
    coverageStartJSWithTimeout: async (page: any, options: any) => {
      return page.coverage.startJSCoverage(options);
    },
    coverageStartCSSWithTimeout: async (page: any, options: any) => {
      return page.coverage.startCSSCoverage(options);
    },
    coverageStopJSWithTimeout: async (page: any) => {
      return page.coverage.stopJSCoverage();
    },
    coverageStopCSSWithTimeout: async (page: any) => {
      return page.coverage.stopCSSCoverage();
    },
  };
});

// Global stubs for barrel sub-modules — prevents loading puppeteer/koffi in tests
// that don't individually mock these paths.
vi.mock('@server/domains/shared/modules/collector', () => ({
  CodeCollector: vi.fn(),
  DOMInspector: vi.fn(),
  PageController: vi.fn(),
  ConsoleMonitor: vi.fn(),
}));

vi.mock('@server/domains/shared/modules/native', () => ({
  MemoryManager: vi.fn(),
  UnifiedProcessManager: vi.fn(),
}));

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
