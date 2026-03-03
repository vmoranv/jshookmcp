// Per-worker setup: initialise the tool registry before any test in this worker.
import { beforeAll } from 'vitest';
import { initRegistry } from '../src/server/registry/index.js';

beforeAll(async () => {
  await initRegistry();
});
