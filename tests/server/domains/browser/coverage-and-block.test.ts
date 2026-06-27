/**
 * page_coverage_start, page_coverage_stop, page_block_script tests (P2)
 */

import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface BaseResponse {
  success?: boolean;
  error?: string;
}

interface CoverageStartResponse extends BaseResponse {
  running?: boolean;
  message?: string;
}

interface CoverageStopResponse extends BaseResponse {
  running?: boolean;
  scriptCount?: number;
  totalBytes?: number;
  usedBytes?: number;
  overallCoveragePct?: string;
  scripts?: Array<{ url: string; totalBytes: number; usedBytes: number; coveragePct: string }>;
}

interface BlockScriptResponse extends BaseResponse {
  action?: string;
  urlPattern?: string;
  count?: number;
  rules?: Array<{ urlPattern: string; reason?: string }>;
  removed?: number;
}

const autoImportCoverage = async () =>
  await import('@server/domains/browser/handlers/coverage-and-block');

describe('P2: page_coverage_start / page_coverage_stop', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns error when coverage is not running and stop is called', async () => {
    const { handlePageCoverageStop, resetCoverageStateForTest } = await autoImportCoverage();
    resetCoverageStateForTest();

    const mockCollector = { getActivePage: vi.fn() };
    const res = parseJson<CoverageStopResponse>(
      await handlePageCoverageStop({ collector: mockCollector as any }, {}),
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain('not running');
  });

  it('returns success with running=true on start (via simulated page with coverage mock)', async () => {
    const { handlePageCoverageStart, handlePageCoverageStop, resetCoverageStateForTest } =
      await autoImportCoverage();
    resetCoverageStateForTest();

    const mockPage = {
      coverage: {
        startJSCoverage: vi.fn().mockResolvedValue(undefined),
        startCSSCoverage: vi.fn().mockResolvedValue(undefined),
        stopJSCoverage: vi.fn().mockResolvedValue([]),
        stopCSSCoverage: vi.fn().mockResolvedValue([]),
      },
    };
    const mockCollector = {
      getActivePage: vi.fn().mockResolvedValue(mockPage),
    };

    const res = parseJson<CoverageStartResponse>(
      await handlePageCoverageStart({ collector: mockCollector as any }, {}),
    );
    expect(res.success).toBe(true);
    expect(res.running).toBe(true);
    // Cleanup: stop coverage to reset state
    await handlePageCoverageStop({ collector: mockCollector as any }, {});
  });

  it('returns already-running when start is called twice', async () => {
    const { handlePageCoverageStart, handlePageCoverageStop, resetCoverageStateForTest } =
      await autoImportCoverage();
    resetCoverageStateForTest();

    const mockPage2 = {
      coverage: {
        startJSCoverage: vi.fn().mockResolvedValue(undefined),
        startCSSCoverage: vi.fn().mockResolvedValue(undefined),
        stopJSCoverage: vi.fn().mockResolvedValue([]),
        stopCSSCoverage: vi.fn().mockResolvedValue([]),
      },
    };
    const mockCollector2 = {
      getActivePage: vi.fn().mockResolvedValue(mockPage2),
    };

    const res1 = parseJson<CoverageStartResponse>(
      await handlePageCoverageStart({ collector: mockCollector2 as any }, {}),
    );
    expect(res1.success).toBe(true);
    expect(res1.running).toBe(true);

    const res2 = parseJson<CoverageStartResponse>(
      await handlePageCoverageStart({ collector: mockCollector2 as any }, {}),
    );
    expect(res2.success).toBe(true);
    expect(res2.running).toBe(true);
    expect(res2.message).toContain('already');

    // Cleanup
    await handlePageCoverageStop({ collector: mockCollector2 as any }, {});
  });
});

describe('P2: page_block_script', () => {
  beforeEach(async () => {
    const { resetScriptBlockRulesForTest } =
      await import('@server/domains/browser/handlers/coverage-and-block');
    resetScriptBlockRulesForTest();
  });

  it('adds a block rule', async () => {
    const { handlePageBlockScript } = await autoImportCoverage();
    const res = parseJson<BlockScriptResponse>(
      await handlePageBlockScript({
        action: 'add',
        urlPattern: 'https://evil.com/tracker.js',
        reason: 'privacy',
      }),
    );
    expect(res.success).toBe(true);
    expect(res.action).toBe('blocked');
    expect(res.rules).toBe(1);
  });

  it('lists all block rules', async () => {
    const { handlePageBlockScript } = await autoImportCoverage();
    await handlePageBlockScript({ action: 'add', urlPattern: '/ads/' });
    await handlePageBlockScript({ action: 'block', urlPattern: '/analytics/' });

    const res = parseJson<BlockScriptResponse>(await handlePageBlockScript({ action: 'list' }));
    expect(res.success).toBe(true);
    expect(res.count).toBe(2);
    expect(res.rules).toHaveLength(2);
  });

  it('removes a specific rule by urlPattern', async () => {
    const { handlePageBlockScript } = await autoImportCoverage();
    await handlePageBlockScript({ action: 'add', urlPattern: '/ads/' });
    await handlePageBlockScript({ action: 'add', urlPattern: '/analytics/' });

    const removeRes = parseJson<BlockScriptResponse>(
      await handlePageBlockScript({ action: 'remove', urlPattern: '/ads/' }),
    );
    expect(removeRes.success).toBe(true);
    expect(removeRes.action).toBe('unblocked');
    expect(removeRes.rules).toBe(1);

    const listRes = parseJson<BlockScriptResponse>(await handlePageBlockScript({ action: 'list' }));
    expect(listRes.count).toBe(1);
    expect(listRes.rules?.[0]?.urlPattern).toBe('/analytics/');
  });

  it('returns error for unknown action', async () => {
    const { handlePageBlockScript } = await autoImportCoverage();
    const res = parseJson<BlockScriptResponse>(await handlePageBlockScript({ action: 'invalid' }));
    expect(res.success).toBe(false);
    expect(res.error).toContain('Unknown action');
  });

  it('returns error for missing urlPattern on add', async () => {
    const { handlePageBlockScript } = await autoImportCoverage();
    const res = parseJson<BlockScriptResponse>(await handlePageBlockScript({ action: 'add' }));
    expect(res.success).toBe(false);
    expect(res.error).toContain('urlPattern is required');
  });

  it('returns error when removing non-existent rule', async () => {
    const { handlePageBlockScript } = await autoImportCoverage();
    const res = parseJson<BlockScriptResponse>(
      await handlePageBlockScript({ action: 'remove', urlPattern: '/nonexistent/' }),
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain('No block rule found');
  });

  it('clears all rules', async () => {
    const { handlePageBlockScript } = await autoImportCoverage();
    await handlePageBlockScript({ action: 'add', urlPattern: '/ads/' });
    await handlePageBlockScript({ action: 'add', urlPattern: '/analytics/' });

    const res = parseJson<BlockScriptResponse>(await handlePageBlockScript({ action: 'clear' }));
    expect(res.success).toBe(true);
    expect(res.action).toBe('cleared');
    expect(res.removed).toBe(2);

    const listRes = parseJson<BlockScriptResponse>(await handlePageBlockScript({ action: 'list' }));
    expect(listRes.count).toBe(0);
  });
});
