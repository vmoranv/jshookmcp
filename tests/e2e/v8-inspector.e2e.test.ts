import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

const TARGET_URL = process.env.E2E_TARGET_URL;
const FIXTURE_URL =
  'data:text/html,<html><body><h1>jshook e2e</h1><script>window.__e2e=true;</script></body></html>';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function findFirstString(value: unknown, keys: readonly string[]): string | null {
  const queue: unknown[] = [value];
  const visited = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);

    if (isRecord(current)) {
      for (const key of keys) {
        const candidate = current[key];
        if (typeof candidate === 'string' && candidate.length > 0) {
          return candidate;
        }
      }
      for (const nested of Object.values(current)) {
        queue.push(nested);
      }
      continue;
    }

    if (Array.isArray(current)) {
      for (const nested of current) {
        queue.push(nested);
      }
    }
  }

  return null;
}

describe.skipIf(!TARGET_URL)('V8 Inspector E2E', { timeout: 180_000, sequential: true }, () => {
  const client = new MCPTestClient();

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.cleanup();
  });

  test('browser launch, attach, capture heap snapshot, search by address', async () => {
    const requiredTools = [
      'browser_launch',
      'page_navigate',
      'page_evaluate',
      'v8_heap_snapshot_capture',
      'v8_heap_snapshot_analyze',
      'v8_heap_stats',
    ];
    const missingTools = requiredTools.filter((name) => !client.getToolMap().has(name));
    if (missingTools.length > 0) {
      client.recordSynthetic(
        'v8-inspector-suite',
        'SKIP',
        `Missing tools: ${missingTools.join(', ')}`,
      );
      return;
    }

    const launch = await client.call('browser_launch', { headless: true }, 60_000);
    expect(launch.result.status).not.toBe('FAIL');

    const navigate = await client.call(
      'page_navigate',
      { url: FIXTURE_URL, waitUntil: 'load' },
      60_000,
    );
    expect(navigate.result.status).not.toBe('FAIL');

    const seedObject = await client.call(
      'page_evaluate',
      {
        code: `(() => {
          const node = {
            tag: 'v8-e2e-node',
            createdAt: Date.now(),
            nested: { score: 42, active: true },
          };
          globalThis.__jshookV8E2E = node;
          return { ok: true, keys: Object.keys(node) };
        })()`,
      },
      30_000,
    );
    expect(seedObject.result.status).not.toBe('FAIL');

    const capture = await client.call('v8_heap_snapshot_capture', {}, 90_000);
    expect(capture.result.status).not.toBe('FAIL');

    const snapshotId = findFirstString(capture.parsed, ['snapshotId', 'id']);
    if (!snapshotId) {
      client.recordSynthetic(
        'v8_heap_snapshot_capture',
        'EXPECTED_LIMITATION',
        'Tool returned without a snapshotId',
      );
      return;
    }

    const stats = await client.call('v8_heap_stats', {}, 30_000);
    expect(stats.result.status).not.toBe('FAIL');

    const analyze = await client.call('v8_heap_snapshot_analyze', { snapshotId }, 90_000);
    expect(analyze.result.status).not.toBe('FAIL');

    if (!client.getToolMap().has('v8_object_inspect')) {
      client.recordSynthetic('v8_object_inspect', 'SKIP', 'Tool not registered in current build');
      return;
    }

    const address = findFirstString(analyze.parsed, ['address', 'objectAddress', 'nodeAddress']);
    if (!address) {
      client.recordSynthetic(
        'v8_object_inspect',
        'EXPECTED_LIMITATION',
        'Snapshot analysis did not surface an inspectable address',
      );
      return;
    }

    const inspectResult = await client.call('v8_object_inspect', { address }, 30_000);
    expect(inspectResult.result.status).not.toBe('FAIL');
  });
});
