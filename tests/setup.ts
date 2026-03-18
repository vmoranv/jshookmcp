// Per-worker setup: initialise the tool registry before any test in this worker.
import { beforeAll, afterEach } from 'vitest';
import { initRegistry } from '@server/registry/index';

// Set test environment variables
process.env.ENABLE_INJECTION_TOOLS = 'true';
process.env.NODE_ENV = 'test';

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
