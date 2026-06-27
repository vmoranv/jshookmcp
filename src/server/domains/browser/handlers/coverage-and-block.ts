/**
 * P2: page_coverage + page_block_script browser tools
 *
 * - page_coverage: Exposes CDP's Profiler/Performance API for JS+CSS code coverage
 *   (already implemented in modules/monitor/PerformanceMonitor.coverage.ts)
 * - page_block_script: Blocks script execution by URL pattern via pattern store
 */

import { argString } from '@server/domains/shared/parse-args';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';
import type { CodeCollector } from '@server/domains/shared/modules/collector';
import { startCoverage, stopCoverage } from '@modules/monitor/PerformanceMonitor.coverage';

// ── State (per browser handler instance) ──

let coverageState: { enabled: boolean; page: unknown | null } = { enabled: false, page: null };

export function resetCoverageStateForTest() {
  coverageState = { enabled: false, page: null };
}

// ── Coverage handlers ──

interface CoverageHandlerDeps {
  collector: CodeCollector;
}

export async function handlePageCoverageStart(
  deps: CoverageHandlerDeps,
  _args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    if (coverageState.enabled) {
      return { success: true, running: true, message: 'Coverage already running' };
    }

    const { coveragePage } = await startCoverage(deps.collector);
    coverageState = { enabled: true, page: coveragePage };

    return {
      success: true,
      running: true,
      message: 'JS+CSS coverage collection started. Use page_coverage_stop to collect results.',
    } as Record<string, unknown>;
  });
}

export async function handlePageCoverageStop(
  deps: CoverageHandlerDeps,
  _unused: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    if (!coverageState.enabled) {
      return {
        success: false,
        error: 'Coverage is not running. Use page_coverage_start first.',
      } as Record<string, unknown>;
    }

    const results = await stopCoverage(deps.collector, coverageState.page as never, true);
    coverageState = { enabled: false, page: null };

    const totalBytes = results.reduce((s, r) => s + r.totalBytes, 0);
    const usedBytes = results.reduce((s, r) => s + r.usedBytes, 0);
    const overallPct = totalBytes > 0 ? ((usedBytes / totalBytes) * 100).toFixed(1) : '0.0';

    return {
      success: true,
      running: false,
      scriptCount: results.length,
      totalBytes,
      usedBytes,
      overallCoveragePct: `${overallPct}%`,
      scripts: results.map((r) => ({
        url: r.url,
        totalBytes: r.totalBytes,
        usedBytes: r.usedBytes,
        coveragePct: r.coveragePercentage.toFixed(1) + '%',
      })),
    };
  });
}

// ── Script blocking handler ──

interface ScriptBlockRule {
  urlPattern: string;
  reason?: string;
  blockedAt?: string;
}

const scriptBlockRules: ScriptBlockRule[] = [];

export function resetScriptBlockRulesForTest() {
  scriptBlockRules.length = 0;
}

export async function handlePageBlockScript(args: Record<string, unknown>): Promise<ToolResponse> {
  return handleSafe(async () => {
    const action = argString(args, 'action', 'add');
    const urlPattern = argString(args, 'urlPattern', '');
    const reason = argString(args, 'reason', '');

    if (action === 'add' || action === 'block') {
      if (!urlPattern) {
        return {
          success: false,
          error: 'urlPattern is required for add/block action',
        } as Record<string, unknown>;
      }
      if (!scriptBlockRules.some((r) => r.urlPattern === urlPattern)) {
        scriptBlockRules.push({
          urlPattern,
          reason: reason || 'blocked by user',
          blockedAt: new Date().toISOString(),
        });
      }
      return { success: true, action: 'blocked', urlPattern, rules: scriptBlockRules.length };
    }

    if (action === 'remove' || action === 'unblock') {
      if (!urlPattern) {
        return {
          success: false,
          error: 'urlPattern is required for remove/unblock action',
        } as Record<string, unknown>;
      }
      const idx = scriptBlockRules.findIndex((r) => r.urlPattern === urlPattern);
      if (idx >= 0) {
        scriptBlockRules.splice(idx, 1);
        return { success: true, action: 'unblocked', urlPattern, rules: scriptBlockRules.length };
      }
      return {
        success: false,
        error: `No block rule found for pattern: ${urlPattern}`,
      } as Record<string, unknown>;
    }

    if (action === 'list') {
      return { success: true, count: scriptBlockRules.length, rules: scriptBlockRules };
    }

    if (action === 'clear') {
      const count = scriptBlockRules.length;
      scriptBlockRules.length = 0;
      return { success: true, action: 'cleared', removed: count };
    }

    return {
      success: false,
      error: `Unknown action: ${action}. Valid actions: add, block, remove, unblock, list, clear`,
    } as Record<string, unknown>;
  });
}
