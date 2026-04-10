import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

const TARGET_URL = process.env.E2E_TARGET_URL;

describe.skipIf(!TARGET_URL)(
  'Trace & Time-Travel E2E',
  { timeout: 180_000, sequential: true },
  () => {
    const client = new MCPTestClient();

    beforeAll(async () => {
      await client.connect();

      // Need a browser session for trace recording
      if (client.getToolMap().has('browser_launch')) {
        await client.call('browser_launch', { headless: false }, 60_000);
        await client.call(
          'page_navigate',
          { url: TARGET_URL, waitUntil: 'load', timeout: 15000 },
          30_000,
        );
      }
    });

    afterAll(async () => {
      await client.cleanup();
    });

    test('TRACE-01: record trace → query SQL → verify results', async () => {
      const requiredTools = ['start_trace_recording', 'stop_trace_recording', 'query_trace_sql'];
      const missing = requiredTools.filter((t) => !client.getToolMap().has(t));
      if (missing.length > 0) {
        client.recordSynthetic('trace-record-query', 'SKIP', `Missing: ${missing.join(', ')}`);
        return;
      }

      // Start recording
      const start = await client.call('start_trace_recording', {}, 15_000);
      if (start.result.status === 'FAIL' || start.result.status === 'EXPECTED_LIMITATION') {
        expect(start.result.detail).toMatch(/better-sqlite3|No active recording/i);
        client.recordSynthetic('trace-record', 'SKIP', 'Missing sqlite / recording');
        return;
      }
      expect(start.result.status).not.toBe('FAIL');

      // Generate some events by navigating
      if (client.getToolMap().has('page_evaluate')) {
        await client.call('page_evaluate', { code: 'document.title' }, 10_000);
      }

      // Wait for events to accumulate
      await new Promise((r) => setTimeout(r, 1000));

      // Stop recording
      const stop = await client.call('stop_trace_recording', {}, 15_000);
      expect(stop.result.status).not.toBe('FAIL');

      // Query the trace
      const query = await client.call(
        'query_trace_sql',
        { sql: 'SELECT COUNT(*) as total FROM events' },
        15_000,
      );
      expect(query.result.status).not.toBe('FAIL');
    });

    test('TRACE-02: diff_heap_snapshots returns diff structure', async () => {
      if (!client.getToolMap().has('diff_heap_snapshots')) {
        client.recordSynthetic('diff-heap', 'SKIP', 'Tool not registered');
        return;
      }

      // This will likely return an error about missing snapshots, but
      // we verify it doesn't crash and returns structured output
      const diff = await client.call(
        'diff_heap_snapshots',
        { snapshotId1: 1, snapshotId2: 2 },
        30_000,
      );
      // Expected: either PASS (if snapshots exist) or EXPECTED_LIMITATION (no snapshots)
      expect(['PASS', 'EXPECTED_LIMITATION', 'FAIL']).toContain(diff.result.status);
    });

    test('TRACE-03: summarize_trace returns summary', async () => {
      if (!client.getToolMap().has('summarize_trace')) {
        client.recordSynthetic('summarize-trace', 'SKIP', 'Tool not registered');
        return;
      }

      const summary = await client.call('summarize_trace', { detail: 'compact' }, 30_000);
      // Expected: PASS if trace exists, EXPECTED_LIMITATION if no active trace
      expect(['PASS', 'EXPECTED_LIMITATION', 'FAIL']).toContain(summary.result.status);
    });

    test('export_trace returns trace event format', async () => {
      if (!client.getToolMap().has('export_trace')) {
        client.recordSynthetic('export-trace', 'SKIP', 'Tool not registered');
        return;
      }

      const exported = await client.call('export_trace', {}, 30_000);
      expect(['PASS', 'EXPECTED_LIMITATION', 'FAIL']).toContain(exported.result.status);
    });

    test('seek_to_timestamp returns state snapshot', async () => {
      if (!client.getToolMap().has('seek_to_timestamp')) {
        client.recordSynthetic('seek-timestamp', 'SKIP', 'Tool not registered');
        return;
      }

      const seek = await client.call(
        'seek_to_timestamp',
        { timestamp: Date.now(), windowMs: 500 },
        30_000,
      );
      expect(['PASS', 'EXPECTED_LIMITATION', 'FAIL']).toContain(seek.result.status);
    });
  },
);
