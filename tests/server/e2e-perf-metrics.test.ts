import { describe, expect, it } from 'vitest';
import {
  buildPerformanceSummary,
  diffProcessMemory,
  parseLinuxProcStatus,
  parsePsMemory,
  parseWindowsProcessJson,
} from '@tests/e2e/helpers/perf-metrics';
import type { ToolResult } from '@tests/e2e/helpers/types';

describe('e2e perf-metrics helpers', () => {
  it('parses linux /proc status memory fields', () => {
    const sample = parseLinuxProcStatus(
      ['Name:\tnode', 'VmSize:\t  2048 kB', 'VmRSS:\t  1024 kB', 'RssAnon:\t   512 kB'].join('\n'),
    );

    expect(sample).toEqual({
      source: 'procfs',
      rssBytes: 1024 * 1024,
      privateBytes: 512 * 1024,
      virtualBytes: 2048 * 1024,
    });
  });

  it('parses ps rss/vsz output', () => {
    const sample = parsePsMemory('12345 67890\n');

    expect(sample).toEqual({
      source: 'ps',
      rssBytes: 12345 * 1024,
      privateBytes: null,
      virtualBytes: 67890 * 1024,
    });
  });

  it('parses powershell process JSON', () => {
    const sample = parseWindowsProcessJson(
      JSON.stringify({
        rssBytes: 4096,
        privateBytes: 2048,
        virtualBytes: 8192,
      }),
    );

    expect(sample).toEqual({
      source: 'powershell',
      rssBytes: 4096,
      privateBytes: 2048,
      virtualBytes: 8192,
    });
  });

  it('computes memory deltas when both samples exist', () => {
    expect(
      diffProcessMemory(
        {
          source: 'procfs',
          rssBytes: 100,
          privateBytes: 50,
          virtualBytes: 200,
        },
        {
          source: 'procfs',
          rssBytes: 160,
          privateBytes: 70,
          virtualBytes: 260,
        },
      ),
    ).toEqual({
      rssBytes: 60,
      privateBytes: 20,
      virtualBytes: 60,
    });
  });

  it('builds a ranked performance summary from tool results', () => {
    const results: ToolResult[] = [
      {
        name: 'slow',
        status: 'PASS',
        detail: 'ok',
        isError: false,
        performance: {
          source: 'server',
          startedAt: '2026-01-01T00:00:00.000Z',
          finishedAt: '2026-01-01T00:00:01.000Z',
          elapsedMs: 1000,
          timeoutMs: 5000,
          serverPid: 1,
          memoryBefore: null,
          memoryAfter: null,
          memoryDelta: { rssBytes: 50, privateBytes: 25, virtualBytes: 75 },
        },
      },
      {
        name: 'fast',
        status: 'EXPECTED_LIMITATION',
        detail: 'timeout',
        isError: false,
        performance: {
          source: 'server',
          startedAt: '2026-01-01T00:00:00.000Z',
          finishedAt: '2026-01-01T00:00:00.100Z',
          elapsedMs: 100,
          timeoutMs: 5000,
          serverPid: 1,
          memoryBefore: null,
          memoryAfter: null,
          memoryDelta: { rssBytes: 5, privateBytes: null, virtualBytes: null },
        },
      },
      {
        name: 'unmeasured',
        status: 'PASS',
        detail: 'ok',
        isError: false,
      },
    ];

    const summary = buildPerformanceSummary(results);

    expect(summary.measuredTools).toBe(2);
    expect(summary.totalElapsedMs).toBe(1100);
    expect(summary.averageElapsedMs).toBe(550);
    expect(summary.slowestTools[0]).toMatchObject({ name: 'slow', elapsedMs: 1000 });
    expect(summary.highestRssDeltaTools[0]).toMatchObject({
      name: 'slow',
      rssDeltaBytes: 50,
    });
  });
});
