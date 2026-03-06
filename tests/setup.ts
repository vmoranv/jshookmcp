// Per-worker setup: initialise the tool registry before any test in this worker.
import { beforeAll } from 'vitest';
import { initRegistry } from '@server/registry/index';

beforeAll(async () => {
  await initRegistry();
});
